import asyncio
import base64
import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional


async def compile_latex(content: str) -> dict:
    """
    Compile LaTeX content to PDF.
    Requires pdflatex or tectonic to be installed on the system.
    Returns dict with: pdf_base64, log, success
    """
    compiler = _find_compiler()
    if not compiler:
        return {
            "success": False,
            "pdf_base64": None,
            "log": (
                "No LaTeX compiler found. Please install TeX Live or MiKTeX.\n"
                "On macOS: brew install --cask mactex-no-gui\n"
                "On Ubuntu: apt-get install texlive-full\n"
                "Or install tectonic: cargo install tectonic"
            ),
        }

    with tempfile.TemporaryDirectory() as tmpdir:
        tex_file = Path(tmpdir) / "document.tex"
        tex_file.write_text(content, encoding="utf-8")

        try:
            if compiler == "tectonic":
                proc = await asyncio.create_subprocess_exec(
                    "tectonic", str(tex_file),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=tmpdir,
                )
            else:
                proc = await asyncio.create_subprocess_exec(
                    compiler,
                    "-interaction=nonstopmode",
                    "-halt-on-error",
                    str(tex_file),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    cwd=tmpdir,
                )

            try:
                stdout, _ = await asyncio.wait_for(proc.communicate(), timeout=60)
            except asyncio.TimeoutError:
                proc.kill()
                return {"success": False, "pdf_base64": None, "log": "Compilation timed out after 60 seconds."}

            log = stdout.decode("utf-8", errors="replace")
            pdf_file = Path(tmpdir) / "document.pdf"

            if pdf_file.exists():
                pdf_bytes = pdf_file.read_bytes()
                pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")
                return {"success": True, "pdf_base64": pdf_b64, "log": log}
            else:
                return {"success": False, "pdf_base64": None, "log": log}

        except Exception as e:
            return {"success": False, "pdf_base64": None, "log": str(e)}


_MACTEX_BIN = "/Library/TeX/texbin"

def _find_compiler() -> Optional[str]:
    search_path = os.environ.get("PATH", "") + os.pathsep + _MACTEX_BIN
    for cmd in ("pdflatex", "xelatex", "lualatex", "tectonic"):
        found = shutil.which(cmd, path=search_path)
        if found:
            return found
    return None
