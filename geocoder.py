"""Compatibility wrapper for archived geocoding helpers.

The ETL pipeline imports ``geocoder`` from the project root. The implementation
was archived during cleanup, so this wrapper keeps the existing import path
working without duplicating the API code.
"""

from _archive.geocoder import BuildingLedgerFetcher, VWorldGeocoder

__all__ = ["BuildingLedgerFetcher", "VWorldGeocoder"]
