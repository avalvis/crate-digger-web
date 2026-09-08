"""Record bundled dependency versions for frozen runtime diagnostics."""
import importlib.metadata
import json
import sys
from pathlib import Path

versions = {
    distribution.metadata["Name"].lower().replace("_", "-"): distribution.version
    for distribution in importlib.metadata.distributions()
    if distribution.metadata["Name"]
}
Path(sys.argv[1]).write_text(json.dumps(versions), encoding="utf-8")
