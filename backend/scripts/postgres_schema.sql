BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR PRIMARY KEY,
    email VARCHAR NOT NULL,
    username VARCHAR NOT NULL,
    hashed_password VARCHAR NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username);

CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR PRIMARY KEY,
    title VARCHAR NOT NULL,
    description TEXT NOT NULL,
    owner_id VARCHAR NOT NULL REFERENCES users (id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_members (
    id VARCHAR PRIMARY KEY,
    project_id VARCHAR NOT NULL REFERENCES projects (id),
    user_id VARCHAR NOT NULL REFERENCES users (id),
    role VARCHAR NOT NULL,
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_project_user UNIQUE (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS project_invites (
    id VARCHAR PRIMARY KEY,
    project_id VARCHAR NOT NULL REFERENCES projects (id),
    token VARCHAR NOT NULL,
    role VARCHAR NOT NULL,
    label VARCHAR NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_project_invites_token ON project_invites (token);

CREATE TABLE IF NOT EXISTS documents (
    id VARCHAR PRIMARY KEY,
    title VARCHAR NOT NULL,
    path VARCHAR NOT NULL DEFAULT 'Untitled Document',
    kind VARCHAR NOT NULL DEFAULT 'latex',
    content TEXT NOT NULL,
    project_id VARCHAR NOT NULL REFERENCES projects (id),
    owner_id VARCHAR NOT NULL REFERENCES users (id),
    source_filename VARCHAR,
    mime_type VARCHAR,
    storage_path TEXT,
    file_size INTEGER,
    content_revision INTEGER NOT NULL DEFAULT 0,
    compile_success BOOLEAN,
    compile_pdf_base64 TEXT,
    compile_log TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS document_versions (
    id VARCHAR PRIMARY KEY,
    document_id VARCHAR NOT NULL REFERENCES documents (id),
    content TEXT NOT NULL,
    created_by_id VARCHAR NOT NULL REFERENCES users (id),
    label VARCHAR NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id VARCHAR PRIMARY KEY,
    document_id VARCHAR NOT NULL REFERENCES documents (id),
    user_id VARCHAR NOT NULL REFERENCES users (id),
    role VARCHAR NOT NULL,
    content TEXT NOT NULL,
    action_type VARCHAR,
    action_prompt TEXT,
    quotes_json TEXT,
    diff_json TEXT,
    retry_action_json TEXT,
    accepted_json TEXT,
    rejected_json TEXT,
    provider VARCHAR,
    model VARCHAR,
    status VARCHAR,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_ai_chat_messages_document_id ON ai_chat_messages (document_id);

COMMIT;
