from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class AIChatMessage(Base):
    __tablename__ = "ai_chat_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    document_id: Mapped[str] = mapped_column(String, ForeignKey("documents.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    action_type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    action_prompt: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    quotes_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    diff_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    retry_action_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    accepted_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rejected_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[DateTime] = mapped_column(DateTime, server_default=func.now())

    document: Mapped["Document"] = relationship("Document", back_populates="ai_messages")
    user: Mapped["User"] = relationship("User")
