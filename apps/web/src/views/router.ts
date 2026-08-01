import { createRouter, createWebHistory } from "vue-router";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { name: "home", path: "/", component: () => import("./WelcomeView.vue") },
    {
      name: "draft",
      path: "/new/:projectId",
      component: () => import("./DraftView.vue"),
    },
    { name: "thread", path: "/threads/:threadId", component: () => import("./WorkspaceView.vue") },
  ],
});
