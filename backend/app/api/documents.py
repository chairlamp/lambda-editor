from __future__ import annotations
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.document import Document
from app.models.user import User
from app.api.auth import get_current_user
from app.api.projects import _require_project
from app.websocket.manager import manager

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])

class DocumentCreate(BaseModel):
    title: str = "Untitled Document"
    content: str = ""


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


class DocumentSummary(BaseModel):
    id: str
    title: str
    owner_id: str
    project_id: str
    updated_at: Optional[str] = None

    class Config:
        from_attributes = True


class DocumentResponse(BaseModel):
    id: str
    title: str
    content: str
    owner_id: str
    project_id: str
    compile_success: Optional[bool] = None
    compile_pdf_base64: Optional[str] = None
    compile_log: Optional[str] = None

    class Config:
        from_attributes = True


def _doc_summary(doc: Document) -> dict:
    return {
        "id": doc.id,
        "title": doc.title,
        "owner_id": doc.owner_id,
        "project_id": doc.project_id,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }

@router.get("", response_model=List[DocumentSummary])
async def list_documents(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)
    res = await db.execute(
        select(Document)
        .where(Document.project_id == project_id)
        .order_by(Document.updated_at.desc())
    )
    docs = res.scalars().all()
    return [
        DocumentSummary(
            id=d.id, title=d.title, owner_id=d.owner_id, project_id=d.project_id,
            updated_at=d.updated_at.isoformat() if d.updated_at else None,
        )
        for d in docs
    ]


@router.post("", response_model=DocumentResponse, status_code=201)
async def create_document(
    project_id: str,
    data: DocumentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    doc = Document(
        id=str(uuid.uuid4()),
        title=data.title,
        content=data.content,
        project_id=project_id,
        owner_id=current_user.id,
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    await manager.broadcast_to_room(
        f"project:{project_id}",
        {"type": "document_created", "document": _doc_summary(doc)},
    )
    return doc


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    project_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)
    res = await db.execute(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(
    project_id: str,
    doc_id: str,
    data: DocumentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    res = await db.execute(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if data.title is not None:
        doc.title = data.title
    if data.content is not None:
        doc.content = data.content

    await db.commit()
    await db.refresh(doc)
    await manager.broadcast_to_room(
        f"project:{project_id}",
        {"type": "document_updated", "document": _doc_summary(doc)},
    )
    return doc


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    project_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, membership = await _require_project(project_id, current_user.id, db, min_role="editor")
    res = await db.execute(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Editors can only delete their own docs; owners can delete any
    if membership.role == "editor" and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the document owner or project owner can delete")

    deleted = _doc_summary(doc)
    await db.delete(doc)
    await db.commit()
    await manager.broadcast_to_room(
        f"project:{project_id}",
        {"type": "document_deleted", "document": deleted},
    )
