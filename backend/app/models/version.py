from __future__ import annotations
import uuid
from sqlalchemy import String, Text, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class DocumentVersion(Base):
    __tablename__ = "document_versions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(String, ForeignKey("documents.id"), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    label: Mapped[str] = mapped_column(String, nullable=False, default="")
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())

    document: Mapped["Document"] = relationship("Document", back_populates="versions")
    created_by: Mapped["User"] = relationship("User")
