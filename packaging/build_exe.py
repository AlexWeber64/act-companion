"""Build the Windows app: dist/ACT-Companion.exe, a single file that needs no Python.

  pip install -e ".[build]"
  python packaging/build_exe.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / "build"
DIST = ROOT / "dist"
STATIC = ROOT / "src" / "act_companion" / "static"
NAME = "ACT-Companion"  # no spaces: GitHub release assets cannot have them

sys.path.insert(0, str(Path(__file__).parent))
import make_icon  # noqa: E402

VERSION_INFO = """VSVersionInfo(
  ffi=FixedFileInfo(filevers={t}, prodvers={t}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'ACT Companion contributors'),
      StringStruct('FileDescription', 'ACT Companion'),
      StringStruct('FileVersion', '{v}'),
      StringStruct('InternalName', 'ACT Companion'),
      StringStruct('LegalCopyright', 'MIT License. Unofficial, not affiliated with the school.'),
      StringStruct('OriginalFilename', 'ACT-Companion.exe'),
      StringStruct('ProductName', 'ACT Companion'),
      StringStruct('ProductVersion', '{v}')])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""


def version():
    text = (ROOT / "src" / "act_companion" / "__init__.py").read_text(encoding="utf-8")
    return re.search(r'__version__ = "([^"]+)"', text).group(1)


def main():
    if sys.platform != "win32":
        sys.exit("The .exe has to be built on Windows.")
    v = version()
    parts = (tuple(int(x) for x in re.findall(r"\d+", v)) + (0, 0, 0, 0))[:4]
    BUILD.mkdir(exist_ok=True)
    vfile = BUILD / "version_info.txt"
    vfile.write_text(VERSION_INFO.format(t=parts, v=v), encoding="utf-8")
    icon = make_icon.main(BUILD / "act-companion.ico")
    cmd = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onefile", "--windowed",
           "--name", NAME, "--icon", str(icon), "--version-file", str(vfile),
           "--paths", str(ROOT / "src"),
           "--add-data", f"{STATIC};act_companion/static",
           "--distpath", str(DIST), "--workpath", str(BUILD / "pyinstaller"), "--specpath", str(BUILD),
           str(Path(__file__).parent / "launcher.py")]
    subprocess.run(cmd, check=True, cwd=ROOT)
    exe = DIST / f"{NAME}.exe"
    print(f"\nBuilt {exe} ({exe.stat().st_size / 1e6:.1f} MB), version {v}")


if __name__ == "__main__":
    main()
