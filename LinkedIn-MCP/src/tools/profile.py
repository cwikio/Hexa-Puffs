"""Profile tools — get_profile, get_own_profile."""

import logging
import os
from typing import Any

from fastmcp import FastMCP

from src import linkedin_client
from src.response import error_response, success_response

logger = logging.getLogger("linkedin")


def _extract_profile(raw: dict[str, Any]) -> dict[str, Any]:
    """Extract relevant fields from a raw Voyager profile blob."""
    return {
        "publicId": raw.get("public_id"),
        "firstName": raw.get("firstName"),
        "lastName": raw.get("lastName"),
        "headline": raw.get("headline"),
        "summary": raw.get("summary"),
        "location": raw.get("locationName"),
        "industry": raw.get("industryName"),
        "experience": [
            {
                "title": exp.get("title"),
                "company": exp.get("companyName"),
                "startDate": exp.get("timePeriod", {}).get("startDate"),
                "endDate": exp.get("timePeriod", {}).get("endDate"),
            }
            for exp in raw.get("experience", [])
        ],
        "education": [
            {
                "school": edu.get("schoolName"),
                "degree": edu.get("degreeName"),
                "field": edu.get("fieldOfStudy"),
            }
            for edu in raw.get("education", [])
        ],
    }


def handle_get_profile(public_id: str) -> dict[str, Any]:
    """Fetch a LinkedIn profile by public ID."""
    try:
        api = linkedin_client.get_client()
        raw = api.get_profile(public_id)
        return success_response(_extract_profile(raw))
    except Exception as e:
        logger.error("Error fetching profile %s: %s", public_id, e)
        return error_response(str(e), "LINKEDIN_ERROR")


def _is_me_error(me: dict[str, Any]) -> bool:
    """Check if /me response is an error (has 'status' key, no profile data)."""
    return "status" in me and "miniProfile" not in me and "publicIdentifier" not in me


def _extract_own_public_id(me: dict[str, Any]) -> str | None:
    """Extract publicIdentifier from various /me response structures."""
    mini = me.get("miniProfile", {})
    if isinstance(mini, dict) and mini.get("publicIdentifier"):
        return mini["publicIdentifier"]
    if me.get("publicIdentifier"):
        return me["publicIdentifier"]
    if me.get("vanityName"):
        return me["vanityName"]
    if me.get("public_id"):
        return me["public_id"]
    return None


def _extract_own_urn_id(me: dict[str, Any]) -> str | None:
    """Extract URN ID from various /me response structures."""
    mini = me.get("miniProfile", {})
    if isinstance(mini, dict):
        urn = mini.get("entityUrn", "")
        if urn and ":" in urn:
            return urn.split(":")[-1]
    urn = me.get("entityUrn", "")
    if urn and ":" in urn:
        return urn.split(":")[-1]
    urn = me.get("objectUrn", "")
    if urn and ":" in urn:
        return urn.split(":")[-1]
    if me.get("plainId"):
        return str(me["plainId"])
    return None


def _get_own_public_id(api: object) -> str | None:
    """Get own public ID, with fallback chain:
    1. Try /me endpoint (may return error)
    2. Retry /me with cache bust
    3. Fall back to LINKEDIN_PUBLIC_ID env var
    """
    me = api.get_user_profile()  # type: ignore[attr-defined]

    # If /me returned an error, try busting cache
    if _is_me_error(me):
        logger.warning("/me returned error (status=%s), retrying without cache...", me.get("status"))
        api.client.metadata.pop("me", None)  # type: ignore[attr-defined]
        me = api.get_user_profile(use_cache=False)  # type: ignore[attr-defined]

    if not _is_me_error(me):
        public_id = _extract_own_public_id(me)
        if public_id:
            return public_id

    # /me still broken — fall back to env var
    env_id = os.environ.get("LINKEDIN_PUBLIC_ID")
    if env_id:
        logger.info("Using LINKEDIN_PUBLIC_ID env var: %s", env_id)
        return env_id

    logger.error("/me failed (keys: %s) and LINKEDIN_PUBLIC_ID not set", list(me.keys()) if me else "None")
    return None


def _get_own_urn_id(api: object) -> str | None:
    """Get own URN ID, with fallback chain:
    1. Try /me endpoint
    2. Fall back to LINKEDIN_PUBLIC_ID → get_profile → profile_id
    """
    me = api.get_user_profile()  # type: ignore[attr-defined]

    if _is_me_error(me):
        api.client.metadata.pop("me", None)  # type: ignore[attr-defined]
        me = api.get_user_profile(use_cache=False)  # type: ignore[attr-defined]

    if not _is_me_error(me):
        urn_id = _extract_own_urn_id(me)
        if urn_id:
            return urn_id

    # /me broken — try fetching profile via public_id to get URN
    public_id = os.environ.get("LINKEDIN_PUBLIC_ID")
    if public_id:
        logger.info("Fetching own URN via LINKEDIN_PUBLIC_ID=%s", public_id)
        try:
            profile = api.get_profile(public_id)  # type: ignore[attr-defined]
            return profile.get("profile_id") or profile.get("member_urn", "").split(":")[-1] or None
        except Exception as e:
            logger.error("Failed to get own URN via profile: %s", e)

    logger.error("/me failed and LINKEDIN_PUBLIC_ID not set — cannot get own URN")
    return None


def handle_get_own_profile() -> dict[str, Any]:
    """Fetch the authenticated user's own profile."""
    try:
        api = linkedin_client.get_client()
        public_id = _get_own_public_id(api)
        if not public_id:
            return error_response(
                "Could not determine own public ID. Set LINKEDIN_PUBLIC_ID env var as fallback.",
                "LINKEDIN_ERROR",
            )
        raw = api.get_profile(public_id)
        return success_response(_extract_profile(raw))
    except Exception as e:
        logger.error("Error fetching own profile: %s", e)
        return error_response(str(e), "LINKEDIN_ERROR")


def register_profile_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def get_profile(public_id: str) -> dict[str, Any]:
        """Get a LinkedIn profile by public ID.

        Args:
            public_id: The LinkedIn public identifier from the profile URL
                       (e.g. 'john-doe-123abc' from linkedin.com/in/john-doe-123abc)
        """
        return handle_get_profile(public_id)

    @mcp.tool()
    def get_own_profile() -> dict[str, Any]:
        """Get the authenticated user's own LinkedIn profile."""
        return handle_get_own_profile()
