from __future__ import annotations
from typing import Optional
from sqlalchemy import String, Text, DateTime, ForeignKey, Boolean, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base
import uuid


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String, nullable=False, default="Untitled Document")
    path: Mapped[str] = mapped_column(String, nullable=False, default="Untitled Document")
    kind: Mapped[str] = mapped_column(String, nullable=False, default="latex", server_default="latex")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    project_id: Mapped[str] = mapped_column(String, ForeignKey("projects.id"), nullable=False)
    owner_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    source_filename: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    mime_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    storage_path: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    content_revision: Mapped[int] = mapped_column(nullable=False, default=0, server_default="0")
    compile_success: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    compile_pdf_base64: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    compile_log: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[DateTime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )

    project: Mapped["Project"] = relationship("Project", back_populates="documents")
    owner: Mapped["User"] = relationship("User")
    versions: Mapped[list["DocumentVersion"]] = relationship(
        "DocumentVersion", back_populates="document", cascade="all, delete-orphan",
        order_by="DocumentVersion.created_at.desc()",
    )
    ai_messages: Mapped[list["AIChatMessage"]] = relationship(
        "AIChatMessage", back_populates="document", cascade="all, delete-orphan",
        order_by="AIChatMessage.created_at.asc()",
    )
