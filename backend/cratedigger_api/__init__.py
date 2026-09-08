"""Crate Digger local web API."""

import sys
from utils.managed_tools import activate, default_data_dir

if not getattr(sys, "frozen", False):
    activate(default_data_dir())

from .app import create_app

__all__ = ["create_app"]
