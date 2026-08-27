import assert from "node:assert/strict";
import test from "node:test";

import { createPictureModeService, validateChatExperience } from "../src/picture-mode.js";

test("Picture experience requires a workspace while normal image generation stays unchanged", () => {
  assert.deepEqual(validateChatExperience({ intent: "image_generate" }), { experience: "normal", pictureWorkspaceId: null });
  assert.throws(() => validateChatExperience({ experience: "picture" }), /missing_picture_workspace_id/);
  assert.deepEqual(validateChatExperience({ experience: "picture", picture_workspace_id: "workspace-1", intent: "image_generate" }), {
    experience: "picture", pictureWorkspaceId: "workspace-1",
  });
});

const setup = (status = "drafting") => {
  const calls = [];
  let active = null;
  let sessionNumber = 0;
  const sessions = {
    async findActiveWorkspace() { return active; },
    async findPictureSession() { return null; },
    async createPictureSession() { sessionNumber += 1; calls.push("session:create"); return { id: `session-${sessionNumber}`, session_kind: "picture" }; },
    async deletePictureSession() { calls.push("session:delete"); active = null; },
    async assertPictureSession({ sessionId }) { if (!String(sessionId).startsWith("session-")) throw Object.assign(new Error("not picture"), { status: 409 }); return { id: sessionId, session_kind: "picture" }; },
  };
  const picture = {
    async ensureWorkspace(input) { calls.push("picture:ensure"); active = { id: `workspace-${sessionNumber}`, chat_session_id: input.sessionId }; return { ...active, status: "drafting" }; },
    async getWorkspace({ workspaceId }) { calls.push("picture:get"); return { id: workspaceId, chat_session_id: active?.chat_session_id || "session-1", status }; },
    async getFiles() { calls.push("picture:files"); return [{ id: "file-1" }]; },
    async approve({ workspaceId }) { calls.push("picture:approve"); return { id: workspaceId, status: "validated", validated_work_id: "work-1" }; },
    async reset() { calls.push("picture:reset"); if (status !== "validated") throw Object.assign(new Error("approval required"), { code: "picture_approval_required", status: 409 }); return { status: "closed" }; },
  };
  const hermes = { async deleteSession() { calls.push("hermes:delete"); } };
  return { calls, service: createPictureModeService({ sessions, picture, hermes }) };
};

test("current is persistent, owner-scoped and approval is idempotent", async () => {
  const { calls, service } = setup("review");
  const user = { id: "user-1", tenant_id: "ens" };
  const current = await service.current(user);
  assert.equal((await service.get(user, current.id)).id, current.id);
  assert.deepEqual(await service.files(user, current.id), [{ id: "file-1" }]);
  const approved = await service.approve(user, current.id);
  assert.equal(approved.validated_work_id, "work-1");
  assert.deepEqual(calls, ["session:create", "picture:ensure", "picture:get", "picture:get", "picture:files", "picture:get", "picture:approve"]);
});

test("new piece refuses unvalidated work and otherwise resets in recoverable order", async () => {
  const denied = setup("review");
  const user = { id: "user-1", tenant_id: "ens" };
  const current = await denied.service.current(user);
  await assert.rejects(denied.service.newPiece(user, current.id), (error) => error.code === "picture_approval_required");

  const allowed = setup("validated");
  const old = await allowed.service.current(user);
  const next = await allowed.service.newPiece(user, old.id);
  assert.equal(next.id, "workspace-2");
  assert.deepEqual(allowed.calls, [
    "session:create", "picture:ensure", "picture:get", "picture:reset", "hermes:delete", "session:delete", "session:create", "picture:ensure",
  ]);
});
