from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.document import Document
from app.models.user import User
from app.api.auth import get_current_user
from app.api.projects import _require_project
from app.services.latex_compiler import compile_latex

router = APIRouter(prefix="/compile", tags=["compile"])


class CompileRequest(BaseModel):
    content: str
    project_id: Optional[str] = None
    doc_id: Optional[str] = None


class CompileResponse(BaseModel):
    success: bool
    pdf_base64: Optional[str]
    log: str


@router.post("", response_model=CompileResponse)
async def compile_document(
    req: CompileRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await compile_latex(req.content)
    if req.project_id and req.doc_id:
        await _require_project(req.project_id, current_user.id, db)
        doc_result = await db.execute(
            select(Document).where(Document.id == req.doc_id, Document.project_id == req.project_id)
        )
        doc = doc_result.scalar_one_or_none()
        if doc:
            doc.compile_success = result["success"]
            doc.compile_pdf_base64 = result["pdf_base64"] if result["success"] else None
            doc.compile_log = result["log"]
            await db.commit()
    return CompileResponse(**result)
