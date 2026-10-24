"""Entry point for the packaged Windows app (PyInstaller cannot start from a module with relative imports)."""
import sys

from act_companion.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
