<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";

import { Button } from "../ui/button/index.js";
import { useWorkspaceStore } from "../shared/workspaceStore.js";

const workspace = useWorkspaceStore();
const router = useRouter();
const projects = computed(() => workspace.shell.projects.filter((project) => !project.hidden));

const start = async (): Promise<void> => {
  const project = projects.value[0];
  if (project === undefined) {
    await router.push({ name: "home", query: { addProject: "true" } });
    return;
  }
  workspace.draftForProject(project.id);
  await router.push({ name: "draft", params: { projectId: project.id } });
};
</script>

<template>
  <section
    class="mx-auto grid h-full w-[min(48rem,100%)] content-center justify-items-center p-[clamp(2rem,8vw,6rem)] text-center text-text-muted"
    aria-labelledby="welcome-title"
  >
    <h1
      id="welcome-title"
      class="m-0 mb-[0.55rem] max-w-[28rem] text-[clamp(1.5rem,3vw,2.2rem)] font-normal leading-[1.1] tracking-[-0.035em] text-text"
    >
      {{ projects.length === 0 ? $t("welcome.noProjectsTitle") : $t("welcome.readyTitle") }}
    </h1>
    <p class="m-0 max-w-[30rem] leading-[1.55]">
      {{ projects.length === 0 ? $t("welcome.noProjectsBody") : $t("welcome.readyBody") }}
    </p>
    <div class="mt-[1.2rem] flex flex-wrap justify-center gap-[0.65rem]">
      <Button variant="primary" type="button" @click="start">
        {{ projects.length === 0 ? $t("projects.add") : $t("navigation.newChat") }}
      </Button>
      <Button
        variant="secondary"
        type="button"
        @click="
          router.push({
            name: 'home',
            query: { settings: 'true' },
          })
        "
      >
        {{ $t("settings.open") }}
      </Button>
    </div>
  </section>
</template>
