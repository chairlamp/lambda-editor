from __future__ import annotations
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.project import Project, ProjectMember, ProjectInvite
from app.models.document import Document
from app.models.user import User
from app.api.auth import get_current_user

router = APIRouter(prefix="/projects", tags=["projects"])

VALID_ROLES = {"owner", "editor", "viewer"}
MAX_INVITES = 3

MAIN_TEX_TEMPLATE = r"""\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage{amsmath}
\usepackage{graphicx}

\title{My Document}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Your content here.

\end{document}
"""


class ProjectCreate(BaseModel):
    title: str
    description: str = ""


class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None


class MemberOut(BaseModel):
    user_id: str
    username: str
    email: str
    role: str

    class Config:
        from_attributes = True


class ProjectOut(BaseModel):
    id: str
    title: str
    description: str
    owner_id: str
    my_role: str
    main_doc_id: Optional[str] = None  # first document id, for auto-redirect

    class Config:
        from_attributes = True


class RoleUpdate(BaseModel):
    role: str


class InviteCreate(BaseModel):
    role: str = "editor"
    label: str = ""


class InviteOut(BaseModel):
    id: str
    project_id: str
    token: str
    role: str
    label: str

    class Config:
        from_attributes = True


class JoinRequest(BaseModel):
    invite_token: str


class DirectAddMember(BaseModel):
    username_or_email: str
    role: str = "editor"


async def _get_membership(
    project_id: str, user_id: str, db: AsyncSession
) -> Optional[ProjectMember]:
    res = await db.execute(
        select(ProjectMember).where(
            ProjectMember.project_id == project_id,
            ProjectMember.user_id == user_id,
        )
    )
    return res.scalar_one_or_none()


async def _require_project(project_id: str, user_id: str, db: AsyncSession, min_role: str = "viewer"):
    """Return project if user has at least min_role, else raise 403/404."""
    res = await db.execute(select(Project).where(Project.id == project_id))
    project = res.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    membership = await _get_membership(project_id, user_id, db)
    if not membership:
        raise HTTPException(status_code=403, detail="Not a member of this project")

    role_rank = {"viewer": 0, "editor": 1, "owner": 2}
    if role_rank.get(membership.role, -1) < role_rank.get(min_role, 0):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    return project, membership


async def _project_out(project: Project, role: str, db: AsyncSession) -> ProjectOut:
    """Build ProjectOut, including the id of the first document for auto-redirect."""
    res = await db.execute(
        select(Document)
        .where(Document.project_id == project.id)
        .order_by(Document.updated_at.asc())
        .limit(1)
    )
    first_doc = res.scalar_one_or_none()
    return ProjectOut(
        id=project.id, title=project.title, description=project.description,
        owner_id=project.owner_id, my_role=role,
        main_doc_id=first_doc.id if first_doc else None,
    )


@router.get("", response_model=List[ProjectOut])
async def list_projects(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    res = await db.execute(
        select(Project)
        .join(ProjectMember, Project.id == ProjectMember.project_id)
        .where(ProjectMember.user_id == current_user.id)
        .order_by(Project.created_at.desc())
    )
    projects = res.scalars().all()

    out = []
    for p in projects:
        membership = await _get_membership(p.id, current_user.id, db)
        out.append(await _project_out(p, membership.role if membership else "viewer", db))
    return out


@router.post("", response_model=ProjectOut, status_code=201)
async def create_project(
    data: ProjectCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project = Project(
        id=str(uuid.uuid4()),
        title=data.title,
        description=data.description,
        owner_id=current_user.id,
    )
    db.add(project)
    await db.flush()

    db.add(ProjectMember(project_id=project.id, user_id=current_user.id, role="owner"))

    # Seed each project with a main document so creation can jump straight into editing.
    main_doc = Document(
        id=str(uuid.uuid4()),
        title="main.tex",
        path="main.tex",
        kind="latex",
        content=MAIN_TEX_TEMPLATE,
        project_id=project.id,
        owner_id=current_user.id,
        mime_type="text/x-tex",
    )
    db.add(main_doc)
    await db.commit()
    await db.refresh(project)

    return ProjectOut(
        id=project.id, title=project.title, description=project.description,
        owner_id=project.owner_id, my_role="owner", main_doc_id=main_doc.id,
    )


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, membership = await _require_project(project_id, current_user.id, db)
    return await _project_out(project, membership.role, db)


@router.patch("/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: str,
    data: ProjectUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, membership = await _require_project(project_id, current_user.id, db, min_role="owner")
    if data.title is not None:
        project.title = data.title
    if data.description is not None:
        project.description = data.description
    await db.commit()
    await db.refresh(project)
    return await _project_out(project, membership.role, db)


@router.delete("/{project_id}", status_code=204)
async def delete_project(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, _ = await _require_project(project_id, current_user.id, db, min_role="owner")
    await db.delete(project)
    await db.commit()


@router.get("/{project_id}/invites", response_model=List[InviteOut])
async def list_invites(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="owner")
    res = await db.execute(
        select(ProjectInvite)
        .where(ProjectInvite.project_id == project_id)
        .order_by(ProjectInvite.created_at.asc())
    )
    return res.scalars().all()


@router.post("/{project_id}/invites", response_model=InviteOut, status_code=201)
async def create_invite(
    project_id: str,
    data: InviteCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="owner")

    if data.role not in ("editor", "viewer"):
        raise HTTPException(status_code=400, detail="Invite role must be editor or viewer")

    res = await db.execute(
        select(ProjectInvite).where(ProjectInvite.project_id == project_id)
    )
    if len(res.scalars().all()) >= MAX_INVITES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_INVITES} invite links per project")

    invite = ProjectInvite(project_id=project_id, role=data.role, label=data.label)
    db.add(invite)
    await db.commit()
    await db.refresh(invite)
    return invite


@router.delete("/{project_id}/invites/{invite_id}", status_code=204)
async def delete_invite(
    project_id: str,
    invite_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="owner")
    res = await db.execute(
        select(ProjectInvite).where(
            ProjectInvite.id == invite_id, ProjectInvite.project_id == project_id
        )
    )
    invite = res.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    await db.delete(invite)
    await db.commit()


@router.post("/memberships", response_model=ProjectOut, status_code=201)
async def create_project_membership(
    data: JoinRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Join a project using an invite link token. The invite's role is applied."""
    res = await db.execute(
        select(ProjectInvite).where(ProjectInvite.token == data.invite_token)
    )
    invite = res.scalar_one_or_none()
    if not invite:
        raise HTTPException(status_code=404, detail="Invalid invite token")

    proj_res = await db.execute(select(Project).where(Project.id == invite.project_id))
    project = proj_res.scalar_one()

    existing = await _get_membership(project.id, current_user.id, db)
    if existing:
        return await _project_out(project, existing.role, db)

    membership = ProjectMember(
        project_id=project.id, user_id=current_user.id, role=invite.role
    )
    db.add(membership)
    await db.commit()

    return await _project_out(project, invite.role, db)


@router.post("/{project_id}/members", response_model=MemberOut, status_code=201)
async def add_member_direct(
    project_id: str,
    data: DirectAddMember,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Add a user to a project directly by username or email (owner only)."""
    await _require_project(project_id, current_user.id, db, min_role="owner")

    if data.role not in VALID_ROLES or data.role == "owner":
        raise HTTPException(status_code=400, detail="Role must be editor or viewer")

    # Look up the target user by username or email.
    identifier = data.username_or_email.strip()
    res = await db.execute(
        select(User).where(
            (User.username == identifier) | (User.email == identifier)
        )
    )
    target = res.scalar_one_or_none()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if target.id == current_user.id:
        raise HTTPException(status_code=400, detail="You are already a member")

    existing = await _get_membership(project_id, target.id, db)
    if existing:
        raise HTTPException(status_code=409, detail="User is already a member of this project")

    membership = ProjectMember(project_id=project_id, user_id=target.id, role=data.role)
    db.add(membership)
    await db.commit()
    return MemberOut(user_id=target.id, username=target.username, email=target.email, role=data.role)


@router.get("/{project_id}/members", response_model=List[MemberOut])
async def list_members(
    project_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db)

    res = await db.execute(
        select(ProjectMember, User)
        .join(User, ProjectMember.user_id == User.id)
        .where(ProjectMember.project_id == project_id)
    )
    rows = res.all()
    return [
        MemberOut(user_id=m.user_id, username=u.username, email=u.email, role=m.role)
        for m, u in rows
    ]


@router.patch("/{project_id}/members/{user_id}", response_model=MemberOut)
async def update_member_role(
    project_id: str,
    user_id: str,
    data: RoleUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _require_project(project_id, current_user.id, db, min_role="owner")

    if data.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Role must be one of {VALID_ROLES}")

    membership = await _get_membership(project_id, user_id, db)
    if not membership:
        raise HTTPException(status_code=404, detail="Member not found")
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot change your own role")

    membership.role = data.role
    await db.commit()

    res = await db.execute(select(User).where(User.id == user_id))
    user = res.scalar_one()
    return MemberOut(user_id=user_id, username=user.username, email=user.email, role=data.role)


@router.delete("/{project_id}/members/{user_id}", status_code=204)
async def remove_member(
    project_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    project, _ = await _require_project(project_id, current_user.id, db, min_role="owner")

    if user_id == project.owner_id:
        raise HTTPException(status_code=400, detail="Cannot remove the project owner")

    membership = await _get_membership(project_id, user_id, db)
    if not membership:
        raise HTTPException(status_code=404, detail="Member not found")

    await db.delete(membership)
    await db.commit()
