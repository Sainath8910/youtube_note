import hashlib
import hmac
import time
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed

from users.authentication import SupabaseJWTAuthentication

from .models import PeerNonce


@dataclass(frozen=True)
class BridgePrincipal:
    installation_id: UUID
    claims: object


class BridgePeerAndUserAuthentication(BaseAuthentication):
    def authenticate(self, request):
        secret = settings.NOTES_SYNC_PEER_SECRET
        expected_peer = settings.NOTES_SYNC_PEER_INSTALLATION_ID
        if len(secret) < 32 or not expected_peer:
            raise ImproperlyConfigured(
                "Notes Bridge peer authentication is not configured."
            )
        try:
            peer_id = UUID(request.headers.get("X-Bridge-Installation", ""))
            timestamp = request.headers.get("X-Bridge-Timestamp", "")
            nonce = request.headers.get("X-Bridge-Nonce", "")
            signature = request.headers.get("X-Bridge-Signature", "")
            if str(peer_id) != str(expected_peer) or not nonce or len(nonce) > 128:
                raise ValueError
            timestamp_value = int(timestamp)
        except (ValueError, TypeError):
            raise AuthenticationFailed("Invalid bridge peer authentication.") from None
        if abs(int(time.time()) - timestamp_value) > 300:
            raise AuthenticationFailed("Expired bridge peer authentication.")
        digest = hashlib.sha256(request.body).hexdigest()
        message = "\n".join((
            request.method.upper(), request.get_full_path(), timestamp, nonce, digest
        )).encode("utf-8")
        expected = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise AuthenticationFailed("Invalid bridge peer authentication.")
        try:
            with transaction.atomic():
                PeerNonce.objects.filter(
                    created_at__lt=timezone.now() - timedelta(minutes=10)
                ).delete()
                PeerNonce.objects.create(peer_installation=peer_id, nonce=nonce)
        except IntegrityError:
            raise AuthenticationFailed("Replayed bridge peer request.") from None
        result = SupabaseJWTAuthentication().authenticate(request)
        if result is None:
            raise AuthenticationFailed("A verified user token is required.")
        user, claims = result
        return user, BridgePrincipal(peer_id, claims)

    def authenticate_header(self, request):
        return "Bearer"
