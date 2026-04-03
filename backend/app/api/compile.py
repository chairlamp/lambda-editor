from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.api.projects import _require_project
from app.database import get_db
from app.models.document import Document
from app.models.user import User
from app.services.latex_compiler import compile_latex

router = APIRouter(tags=["compile"])


class CompileRequest(BaseModel):
    content: str
    output_format: str = "pdf"


class CompileResponse(BaseModel):
    success: bool
    pdf_base64: Optional[str]
    file_base64: Optional[str]
    file_name: Optional[str]
    mime_type: Optional[str]
    output_format: str
    log: str


@router.post("/projects/{project_id}/documents/{doc_id}/compilations", response_model=CompileResponse, status_code=201)
async def compile_document(
    project_id: str,
    doc_id: str,
    req: CompileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project_documents: list[Document] = []
    active_doc: Optional[Document] = None

    await _require_project(project_id, current_user.id, db)
    doc_result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    active_doc = doc_result.scalar_one_or_none()
    if not active_doc:
        return CompileResponse(
            success=False,
            pdf_base64=None,
            file_base64=None,
            file_name=None,
            mime_type=None,
            output_format=req.output_format,
            log="Document not found",
        )
    if active_doc.kind != "latex":
        return CompileResponse(
            success=False,
            pdf_base64=None,
            file_base64=None,
            file_name=None,
            mime_type=None,
            output_format=req.output_format,
            log="Only LaTeX documents can be compiled.",
        )
    docs_result = await db.execute(select(Document).where(Document.project_id == project_id))
    project_documents = docs_result.scalars().all()

    file_tree: dict[str, dict[str, str]] = {}
    for project_doc in project_documents:
        if project_doc.kind in {"latex", "text"}:
            file_tree[project_doc.path] = {"type": "text", "content": project_doc.content}
        elif project_doc.storage_path:
            file_tree[project_doc.path] = {"type": "binary", "content": project_doc.storage_path}
    file_tree[active_doc.path] = {"type": "text", "content": req.content}
    result = await compile_latex(req.content, req.output_format, entry_path=active_doc.path, file_tree=file_tree)

    if active_doc and req.output_format == "pdf":
        active_doc.compile_success = result["success"]
        active_doc.compile_pdf_base64 = result["pdf_base64"] if result["success"] else None
        active_doc.compile_log = result["log"]
        await db.commit()

    return CompileResponse(**result)
