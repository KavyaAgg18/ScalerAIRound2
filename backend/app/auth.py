import hashlib
import hmac
import os
import secrets
from datetime import timedelta

from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from .db import get_db, utcnow
from .errors import ApiError
from .models import Session, User
from .schemas import LoginIn, UserOut

COOKIE = "r53_session"
SESSION_TTL = timedelta(hours=int(os.environ.get("SESSION_TTL_HOURS", "24")))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
ITERATIONS = 200_000

# Mocked AWS identity for the account menu (no real AWS account behind the demo).
ACCOUNT = {
    "account_name": os.environ.get("ACCOUNT_NAME", "Demo Organization"),
    "account_id": os.environ.get("ACCOUNT_ID", "123456789012"),
    "role": os.environ.get("ACCOUNT_ROLE", "developer"),
}

router = APIRouter(prefix="/api/auth", tags=["auth"])


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    _, iterations, salt, digest = stored.split("$")
    candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iterations))
    return hmac.compare_digest(candidate.hex(), digest)


def _token_id(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def current_user(r53_session: str | None = Cookie(None), db: DbSession = Depends(get_db)) -> User:
    if r53_session:
        session = db.get(Session, _token_id(r53_session))
        if session and session.expires_at > utcnow():
            return session.user
    raise ApiError(401, "Your session has expired. Sign in again.")


@router.post("/login", response_model=UserOut)
def login(body: LoginIn, response: Response, db: DbSession = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == body.username.strip()))
    if not user or not verify_password(body.password, user.password_hash):
        raise ApiError(401, "Incorrect user name or password.")
    db.execute(delete(Session).where(Session.expires_at <= utcnow()))
    token = secrets.token_urlsafe(32)
    db.add(Session(id=_token_id(token), user_id=user.id, expires_at=utcnow() + SESSION_TTL))
    db.commit()
    response.set_cookie(
        COOKIE,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )
    return {"username": user.username, **ACCOUNT}


@router.post("/logout", status_code=204)
def logout(response: Response, r53_session: str | None = Cookie(None), db: DbSession = Depends(get_db)):
    if r53_session:
        db.execute(delete(Session).where(Session.id == _token_id(r53_session)))
        db.commit()
    response.delete_cookie(COOKIE, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return {"username": user.username, **ACCOUNT}
