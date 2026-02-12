"""Profile tools — get_profile, get_own_profile."""

import logging
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


def handle_get_own_profile() -> dict[str, Any]:
    """Fetch the authenticated user's own profile."""
    try:
        api = linkedin_client.get_client()
        me = api.get_user_profile()
        public_id = me.get("miniProfile", {}).get("publicIdentifier")
        if not public_id:
            return error_response("Could not determine own public ID", "LINKEDIN_ERROR")
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
