from __future__ import annotations
import uuid
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.document import Document
from app.models.version import DocumentVersion
from app.models.user import User
from app.api.auth import get_current_user
from app.api.projects import _require_project
from app.websocket.manager import manager
from app.websocket import yjs_handler

router = APIRouter(
    prefix="/projects/{project_id}/documents/{doc_id}/versions",
    tags=["versions"],
)


class VersionCreate(BaseModel):
    label: str = ""


class VersionOut(BaseModel):
    id: str
    document_id: str
    label: str
    created_by_id: str
    created_by_username: str
    created_at: str

    class Config:
        from_attributes = True


class VersionDetail(VersionOut):
    content: str


async def _get_doc(project_id: str, doc_id: str, db: AsyncSession) -> Document:
    res = await db.execute(
        select(Document).where(Document.id == doc_id, Document.project_id == project_id)
    )
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.kind == "uploaded":
        raise HTTPException(status_code=400, detail="Version history is not available for binary uploaded files")
    return doc


@router.get("", response_model=List[VersionOut])
async def list_versions(
    project_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)
    await _get_doc(project_id, doc_id, db)

    res = await db.execute(
        select(DocumentVersion, User)
        .join(User, DocumentVersion.created_by_id == User.id)
        .where(DocumentVersion.document_id == doc_id)
        .order_by(DocumentVersion.created_at.desc())
    )
    rows = res.all()
    return [
        VersionOut(
            id=v.id, document_id=v.document_id, label=v.label,
            created_by_id=v.created_by_id, created_by_username=u.username,
            created_at=v.created_at.isoformat(),
        )
        for v, u in rows
    ]


@router.post("", response_model=VersionOut, status_code=201)
async def create_version(
    project_id: str,
    doc_id: str,
    data: VersionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    doc = await _get_doc(project_id, doc_id, db)

    version = DocumentVersion(
        id=str(uuid.uuid4()),
        document_id=doc_id,
        content=doc.content,
        created_by_id=current_user.id,
        label=data.label,
    )
    db.add(version)
    await db.commit()
    await db.refresh(version)

    return VersionOut(
        id=version.id, document_id=version.document_id, label=version.label,
        created_by_id=version.created_by_id, created_by_username=current_user.username,
        created_at=version.created_at.isoformat(),
    )


@router.get("/{version_id}", response_model=VersionDetail)
async def get_version(
    project_id: str,
    doc_id: str,
    version_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)
    res = await db.execute(
        select(DocumentVersion, User)
        .join(User, DocumentVersion.created_by_id == User.id)
        .where(DocumentVersion.id == version_id, DocumentVersion.document_id == doc_id)
    )
    row = res.first()
    if not row:
        raise HTTPException(status_code=404, detail="Version not found")
    v, u = row
    return VersionDetail(
        id=v.id, document_id=v.document_id, label=v.label, content=v.content,
        created_by_id=v.created_by_id, created_by_username=u.username,
        created_at=v.created_at.isoformat(),
    )


@router.post("/{version_id}/restorations", response_model=VersionDetail, status_code=201)
async def create_version_restoration(
    project_id: str,
    doc_id: str,
    version_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    doc = await _get_doc(project_id, doc_id, db)

    res = await db.execute(
        select(DocumentVersion).where(
            DocumentVersion.id == version_id, DocumentVersion.document_id == doc_id
        )
    )
    ver = res.scalar_one_or_none()
    if not ver:
        raise HTTPException(status_code=404, detail="Version not found")

    snapshot = DocumentVersion(
        id=str(uuid.uuid4()),
        document_id=doc_id,
        content=doc.content,
        created_by_id=current_user.id,
        label=f"Before restore to {ver.label}",
    )
    db.add(snapshot)

    doc.content = ver.content
    doc.content_revision += 1
    await db.commit()

    # Only Yjs-backed document kinds need the CRDT room invalidated on restore.
    if doc.kind in {"latex", "text"}:
        await yjs_handler.invalidate_room(doc_id, ver.content)

    await manager.broadcast_to_room(
        doc_id,
        {
            "type": "update",
            "content": doc.content,
            "revision": doc.content_revision,
            "restored_from_version_id": ver.id,
            "user_id": current_user.id,
        },
    )

    return VersionDetail(
        id=ver.id, document_id=ver.document_id, label=ver.label, content=ver.content,
        created_by_id=ver.created_by_id, created_by_username=current_user.username,
        created_at=ver.created_at.isoformat(),
    )
