"""Search tools — search_people, search_companies, get_company."""

import logging
from typing import Any

from fastmcp import FastMCP

from src import linkedin_client
from src.response import error_response, success_response

logger = logging.getLogger("linkedin")


def handle_search_people(
    keywords: str,
    limit: int = 10,
) -> dict[str, Any]:
    """Search for people on LinkedIn."""
    try:
        api = linkedin_client.get_client()
        results = api.search_people(
            keywords=keywords,
            limit=limit,
        )
        people = [
            {
                "publicId": p.get("public_id"),
                "name": p.get("name"),
                "headline": p.get("headline"),
                "location": p.get("location"),
                "urnId": p.get("urn_id"),
            }
            for p in results
        ]
        return success_response({"results": people, "count": len(people)})
    except Exception as e:
        logger.error("Error searching people: %s", e)
        return error_response(str(e), "LINKEDIN_ERROR")


def handle_search_companies(
    keywords: str,
    limit: int = 10,
) -> dict[str, Any]:
    """Search for companies on LinkedIn."""
    try:
        api = linkedin_client.get_client()
        results = api.search_companies(keywords=keywords)
        companies = []
        for c in results[:limit]:
            companies.append({
                "name": c.get("name"),
                "universalName": c.get("universal_name") or c.get("universalName"),
                "headline": c.get("headline", ""),
                "subline": c.get("subline", ""),
                "urnId": c.get("urn_id"),
            })
        return success_response({"results": companies, "count": len(companies)})
    except Exception as e:
        logger.error("Error searching companies: %s", e)
        return error_response(str(e), "LINKEDIN_ERROR")


def handle_get_company(public_id: str) -> dict[str, Any]:
    """Get detailed company information by public ID (universal name)."""
    try:
        api = linkedin_client.get_client()
        raw = api.get_company(public_id)
        company = {
            "name": raw.get("name"),
            "universalName": raw.get("universalName"),
            "description": raw.get("description", ""),
            "website": raw.get("companyPageUrl") or raw.get("website", ""),
            "industry": raw.get("companyIndustries", [{}])[0].get("localizedName", "") if raw.get("companyIndustries") else "",
            "staffCount": raw.get("staffCount", 0),
            "headquarter": raw.get("headquarter", {}),
            "specialities": raw.get("specialities", []),
            "foundedOn": raw.get("foundedOn", {}),
        }
        return success_response(company)
    except Exception as e:
        logger.error("Error fetching company %s: %s", public_id, e)
        return error_response(str(e), "LINKEDIN_ERROR")


def register_search_tools(mcp: FastMCP) -> None:
    @mcp.tool()
    def search_people(keywords: str, limit: int = 10) -> dict[str, Any]:
        """Search for people on LinkedIn by keywords.

        Args:
            keywords: Search query (name, title, company, etc.)
            limit: Maximum number of results to return (default: 10)
        """
        return handle_search_people(keywords, limit)

    @mcp.tool()
    def search_companies(keywords: str, limit: int = 10) -> dict[str, Any]:
        """Search for companies on LinkedIn by keywords.

        Args:
            keywords: Search query (company name, industry, etc.)
            limit: Maximum number of results to return (default: 10)
        """
        return handle_search_companies(keywords, limit)

    @mcp.tool()
    def get_company(public_id: str) -> dict[str, Any]:
        """Get detailed information about a LinkedIn company.

        Args:
            public_id: The company's universal name / public ID (from URL or search results)
        """
        return handle_get_company(public_id)
