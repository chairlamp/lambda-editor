from __future__ import annotations

import os
import uuid
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.api.projects import _require_project
from app.config import settings
from app.database import get_db
from app.models.ai_chat import AIChatMessage
from app.models.document import Document
from app.models.project import Folder
from app.models.user import User
from app.models.version import DocumentVersion
from app.websocket.manager import manager

router = APIRouter(prefix="/projects/{project_id}/documents", tags=["documents"])


class DocumentCreate(BaseModel):
    path: str = "untitled.txt"
    content: str = ""


class DocumentUpdate(BaseModel):
    title: Optional[str] = None
    path: Optional[str] = None
    content: Optional[str] = None


class FolderCreate(BaseModel):
    path: str


class FolderSummary(BaseModel):
    id: str
    path: str
    owner_id: str
    project_id: str

    class Config:
        from_attributes = True


class DocumentSummary(BaseModel):
    id: str
    title: str
    path: str
    kind: str
    owner_id: str
    project_id: str
    source_filename: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    content_revision: int
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DocumentResponse(BaseModel):
    id: str
    title: str
    path: str
    kind: str
    content: str
    owner_id: str
    project_id: str
    source_filename: Optional[str] = None
    mime_type: Optional[str] = None
    file_size: Optional[int] = None
    content_revision: int
    updated_at: Optional[datetime] = None
    compile_success: Optional[bool] = None
    compile_pdf_base64: Optional[str] = None
    compile_log: Optional[str] = None

    class Config:
        from_attributes = True


def _normalize_path(raw_path: str) -> str:
    path = (raw_path or "").strip().replace("\\", "/")
    if not path:
        raise HTTPException(status_code=400, detail="Path is required")
    if path.startswith("/") or ".." in PurePosixPath(path).parts:
        raise HTTPException(status_code=400, detail="Invalid path")
    normalized = str(PurePosixPath(path))
    if normalized in {"", "."}:
        raise HTTPException(status_code=400, detail="Invalid path")
    return normalized


def _basename(path: str) -> str:
    return PurePosixPath(path).name


def _parent_directories(path: str) -> list[str]:
    parts = PurePosixPath(path).parts[:-1]
    return [str(PurePosixPath(*parts[:idx])) for idx in range(1, len(parts) + 1)]


def _infer_kind(path: str, mime_type: Optional[str] = None) -> str:
    ext = Path(path).suffix.lower()
    if ext in {".tex", ".ltx", ".latex"} or (mime_type or "").lower() in {"application/x-tex", "text/x-tex"}:
        return "latex"
    text_exts = {
        ".txt", ".md", ".markdown", ".py", ".js", ".jsx", ".ts", ".tsx", ".json",
        ".yaml", ".yml", ".xml", ".html", ".css", ".scss", ".sh", ".bash", ".zsh",
        ".toml", ".ini", ".cfg", ".csv",
    }
    if (mime_type or "").startswith("text/") or ext in text_exts:
        return "text"
    return "uploaded"


def _safe_filename(filename: str) -> str:
    cleaned = "".join(ch for ch in filename if ch.isalnum() or ch in {".", "_", "-"}).strip("._")
    return cleaned or "upload.bin"


def _decode_text_content(data: bytes) -> str:
    return data.decode("utf-8", errors="replace")


def _temp_download_path(doc: Document) -> Path:
    return Path(settings.UPLOADS_DIR) / doc.project_id / f"{doc.id}-download-{_safe_filename(_basename(doc.path))}"


def _doc_summary(doc: Document) -> dict:
    return {
        "id": doc.id,
        "title": doc.title,
        "path": doc.path,
        "kind": doc.kind,
        "owner_id": doc.owner_id,
        "project_id": doc.project_id,
        "source_filename": doc.source_filename,
        "mime_type": doc.mime_type,
        "file_size": doc.file_size,
        "content_revision": doc.content_revision,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
    }


def _folder_summary(folder: Folder) -> dict:
    return {
        "id": folder.id,
        "path": folder.path,
        "owner_id": folder.owner_id,
        "project_id": folder.project_id,
    }


async def _ensure_unique_document_path(project_id: str, path: str, db: AsyncSession, *, excluding_doc_id: Optional[str] = None):
    res = await db.execute(select(Document).where(Document.project_id == project_id, Document.path == path))
    existing = res.scalar_one_or_none()
    if existing and existing.id != excluding_doc_id:
        raise HTTPException(status_code=409, detail="A document already exists at that path")


async def _ensure_directories(project_id: str, owner_id: str, folder_paths: list[str], db: AsyncSession):
    for folder_path in folder_paths:
        res = await db.execute(select(Folder).where(Folder.project_id == project_id, Folder.path == folder_path))
        if not res.scalar_one_or_none():
            db.add(Folder(id=str(uuid.uuid4()), path=folder_path, project_id=project_id, owner_id=owner_id))


@router.get("", response_model=List[DocumentSummary])
async def list_documents(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)
    res = await db.execute(select(Document).where(Document.project_id == project_id).order_by(Document.path.asc()))
    docs = res.scalars().all()
    return [
        DocumentSummary(
            id=d.id,
            title=d.title,
            path=d.path,
            kind=d.kind,
            owner_id=d.owner_id,
            project_id=d.project_id,
            source_filename=d.source_filename,
            mime_type=d.mime_type,
            file_size=d.file_size,
            content_revision=d.content_revision,
            updated_at=d.updated_at.isoformat() if d.updated_at else None,
        )
        for d in docs
    ]


@router.get("/folders", response_model=List[FolderSummary])
async def list_folders(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)
    res = await db.execute(select(Folder).where(Folder.project_id == project_id).order_by(Folder.path.asc()))
    return [FolderSummary(**_folder_summary(folder)) for folder in res.scalars().all()]


@router.post("/folders", response_model=FolderSummary, status_code=201)
async def create_folder(
    project_id: str,
    data: FolderCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    path = _normalize_path(data.path.rstrip("/"))
    res = await db.execute(select(Folder).where(Folder.project_id == project_id, Folder.path == path))
    folder = res.scalar_one_or_none()
    if folder:
        return FolderSummary(**_folder_summary(folder))
    await _ensure_directories(project_id, current_user.id, _parent_directories(f"{path}/placeholder.txt")[:-1], db)
    folder = Folder(id=str(uuid.uuid4()), path=path, project_id=project_id, owner_id=current_user.id)
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    await manager.broadcast_to_room(f"project:{project_id}", {"type": "folder_created", "folder": _folder_summary(folder)})
    return FolderSummary(**_folder_summary(folder))


@router.post("", response_model=DocumentResponse, status_code=201)
async def create_document(
    project_id: str,
    data: DocumentCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    path = _normalize_path(data.path)
    await _ensure_unique_document_path(project_id, path, db)
    await _ensure_directories(project_id, current_user.id, _parent_directories(path), db)
    kind = _infer_kind(path)
    doc = Document(
        id=str(uuid.uuid4()),
        title=_basename(path),
        path=path,
        kind=kind,
        content=data.content,
        project_id=project_id,
        owner_id=current_user.id,
        mime_type="text/x-tex" if kind == "latex" else ("text/plain" if kind == "text" else None),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    await manager.broadcast_to_room(f"project:{project_id}", {"type": "document_created", "document": _doc_summary(doc)})
    return doc


@router.post("/uploaded-documents", response_model=DocumentResponse, status_code=201)
async def create_uploaded_document(
    project_id: str,
    file: UploadFile = File(...),
    path: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    source_filename = file.filename or "upload.bin"
    normalized_path = _normalize_path(path or source_filename)
    await _ensure_unique_document_path(project_id, normalized_path, db)
    await _ensure_directories(project_id, current_user.id, _parent_directories(normalized_path), db)
    file_bytes = await file.read()
    mime_type = file.content_type or "application/octet-stream"
    kind = _infer_kind(normalized_path, mime_type)

    storage_path: Optional[str] = None
    content = ""
    if kind in {"latex", "text"}:
        content = _decode_text_content(file_bytes)
        mime_type = "text/x-tex" if kind == "latex" else (file.content_type or "text/plain")
    else:
        upload_dir = Path(settings.UPLOADS_DIR) / project_id / Path(normalized_path).parent
        upload_dir.mkdir(parents=True, exist_ok=True)
        storage_path = str(upload_dir / f"{uuid.uuid4()}-{_safe_filename(_basename(normalized_path))}")
        with open(storage_path, "wb") as out:
            out.write(file_bytes)

    doc = Document(
        id=str(uuid.uuid4()),
        title=_basename(normalized_path),
        path=normalized_path,
        kind=kind,
        content=content,
        project_id=project_id,
        owner_id=current_user.id,
        source_filename=source_filename,
        mime_type=mime_type,
        storage_path=storage_path,
        file_size=len(file_bytes),
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    await manager.broadcast_to_room(f"project:{project_id}", {"type": "document_created", "document": _doc_summary(doc)})
    return doc


@router.get("/{doc_id}", response_model=DocumentResponse)
async def get_document(
    project_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)
    res = await db.execute(select(Document).where(Document.id == doc_id, Document.project_id == project_id))
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.get("/{doc_id}/download")
async def download_document(
    project_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)
    res = await db.execute(select(Document).where(Document.id == doc_id, Document.project_id == project_id))
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.kind in {"latex", "text"}:
        download_path = _temp_download_path(doc)
        download_path.parent.mkdir(parents=True, exist_ok=True)
        download_path.write_text(doc.content or "", encoding="utf-8")
        return FileResponse(download_path, media_type=doc.mime_type or "text/plain", filename=_basename(doc.path))

    if not doc.storage_path or not os.path.exists(doc.storage_path):
        raise HTTPException(status_code=404, detail="Uploaded file is missing")
    return FileResponse(doc.storage_path, media_type=doc.mime_type or "application/octet-stream", filename=_basename(doc.path))


@router.patch("/{doc_id}", response_model=DocumentResponse)
async def update_document(
    project_id: str,
    doc_id: str,
    data: DocumentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="editor")
    res = await db.execute(select(Document).where(Document.id == doc_id, Document.project_id == project_id))
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    next_path = doc.path
    if data.path is not None:
        next_path = _normalize_path(data.path)
    elif data.title is not None:
        parent = str(PurePosixPath(doc.path).parent)
        next_path = _normalize_path(f"{parent}/{data.title}" if parent not in {"", "."} else data.title)

    if next_path != doc.path:
        await _ensure_unique_document_path(project_id, next_path, db, excluding_doc_id=doc.id)
        await _ensure_directories(project_id, current_user.id, _parent_directories(next_path), db)
        doc.path = next_path
        doc.title = _basename(next_path)
        doc.kind = _infer_kind(next_path, doc.mime_type)
        if doc.kind in {"latex", "text"}:
            doc.storage_path = None

    if data.content is not None:
        if doc.kind == "uploaded":
            raise HTTPException(status_code=400, detail="Binary uploaded files are read-only in the editor")
        doc.content = data.content
        doc.content_revision += 1

    await db.commit()
    await db.refresh(doc)
    await manager.broadcast_to_room(f"project:{project_id}", {"type": "document_updated", "document": _doc_summary(doc)})
    return doc


@router.delete("/{doc_id}", status_code=204)
async def delete_document(
    project_id: str,
    doc_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, membership = await _require_project(project_id, current_user.id, db, min_role="editor")
    res = await db.execute(select(Document).where(Document.id == doc_id, Document.project_id == project_id))
    doc = res.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if membership.role == "editor" and doc.owner_id != current_user.id:
        raise HTTPException(status_code=403, detail="Only the document owner or project owner can delete")

    deleted = _doc_summary(doc)
    await db.execute(delete(DocumentVersion).where(DocumentVersion.document_id == doc_id))
    await db.execute(delete(AIChatMessage).where(AIChatMessage.document_id == doc_id))
    if doc.storage_path and os.path.exists(doc.storage_path):
        try:
            os.remove(doc.storage_path)
        except OSError:
            pass
    temp_download = _temp_download_path(doc)
    if temp_download.exists():
        try:
            os.remove(temp_download)
        except OSError:
            pass
    await db.delete(doc)
    await db.commit()
    await manager.broadcast_to_room(f"project:{project_id}", {"type": "document_deleted", "document": deleted})
