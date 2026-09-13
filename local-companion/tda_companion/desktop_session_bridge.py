from __future__ import annotations

from .asr_models import get_profile
from .desktop import DesktopBridge, _CRAIG_SOURCE_ID, _PROFILE_ORDER
from .qwen_desktop_prepare import QwenDesktopPrepareError, prepare_qwen_profile_from_craig


class SessionDesktopBridge(DesktopBridge):
    """Desktop product workflow layered over the generic maintenance bridge."""

    def _require_selected_source(self, source_id: str) -> None:
        if not isinstance(source_id, str) or not _CRAIG_SOURCE_ID.fullmatch(source_id):
            raise RuntimeError("CRAIG_SOURCE_INVALID")
        if source_id not in self._selected_sources:
            raise RuntimeError("CRAIG_SOURCE_NOT_SELECTED")

    def prepare_transcription_profile(self, source_id: str, profile_id: str) -> dict[str, object]:
        self._require_selected_source(source_id)
        if profile_id not in _PROFILE_ORDER:
            raise RuntimeError("TRANSCRIPTION_PROFILE_INVALID")
        if self._has_running_job():
            raise RuntimeError("TRANSCRIPTION_PREPARATION_BLOCKED_BY_RUNNING_JOB")

        current = self.transcription_profiles()
        selected = next((item for item in current["profiles"] if item["id"] == profile_id), None)
        if isinstance(selected, dict) and selected.get("ready") is True:
            return {"ready": True, "profile_id": profile_id, "prepared": False}

        profile = get_profile(profile_id)
        if profile.engine == "whisper":
            runtime = self.install_whisper_runtime()
            refreshed = self.transcription_profiles()
            ready = next((item for item in refreshed["profiles"] if item["id"] == profile_id), None)
            if not isinstance(ready, dict) or ready.get("ready") is not True:
                raise RuntimeError("WHISPER_RUNTIME_UNAVAILABLE")
            return {
                "ready": True,
                "profile_id": profile_id,
                "prepared": bool(runtime.get("accepted")),
                "runtime_version": runtime.get("version"),
                "model_prepare_on_job": True,
            }

        runtime = self.install_qwen_runtime()
        try:
            result = prepare_qwen_profile_from_craig(
                data_root=self.paths.data_root,
                cache_root=self.paths.cache_root,
                models_root=self.paths.models_root,
                runtime_root=self.paths.runtime_root,
                state_root=self.paths.state_root,
                source_id=source_id,
                profile_id=profile_id,
            )
        except QwenDesktopPrepareError as exc:
            raise RuntimeError(exc.code) from None

        refreshed = self.transcription_profiles()
        ready = next((item for item in refreshed["profiles"] if item["id"] == profile_id), None)
        if not isinstance(ready, dict) or ready.get("ready") is not True:
            raise RuntimeError("QWEN_PHYSICAL_ACCEPTANCE_NOT_VISIBLE")
        return {
            **result,
            "prepared": True,
            "runtime_version": runtime.get("version"),
        }
