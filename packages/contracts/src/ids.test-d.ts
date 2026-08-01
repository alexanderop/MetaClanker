import type { ProjectId, ThreadId } from "./ids.js";
import { ProjectId as ProjectIdSchema, ThreadId as ThreadIdSchema } from "./ids.js";

const projectId: ProjectId = ProjectIdSchema.make("project");
const threadId: ThreadId = ThreadIdSchema.make("thread");

// @ts-expect-error Branded aggregate identifiers must never be interchangeable.
const invalidThread: ThreadId = projectId;
// @ts-expect-error Branded aggregate identifiers must never be interchangeable.
const invalidProject: ProjectId = threadId;

void invalidThread;
void invalidProject;
