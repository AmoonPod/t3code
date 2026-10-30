import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadDetailRef, threadRunStopAtom } from "./entities";
import { environmentThreadDetails } from "./threads";

const ref = scopeThreadRef("env-1" as EnvironmentId, "thread-1" as ThreadId);

describe("threadRunStopAtom", () => {
  it("never reads thread detail for a draft until the server shell exists", () => {
    const draftRef = resolveThreadDetailRef(ref, { shellExists: false, waitForShell: true });
    expect(draftRef).toBeNull();

    const draftAtom = threadRunStopAtom(draftRef);
    expect(draftAtom).not.toBe(environmentThreadDetails.runStopAtom(ref));
    expect(AtomRegistry.make().get(draftAtom)).toBeNull();

    const serverRef = resolveThreadDetailRef(ref, { shellExists: true, waitForShell: true });
    expect(threadRunStopAtom(serverRef)).toBe(environmentThreadDetails.runStopAtom(ref));
  });
});
