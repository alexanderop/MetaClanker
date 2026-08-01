<template>
  <section class="welcome-view" aria-labelledby="welcome-title">
    <div class="welcome-orbit" aria-hidden="true">
      <span class="orbit-node root" />
      <span class="orbit-node child-one" />
      <span class="orbit-node child-two" />
      <span class="orbit-line line-one" />
      <span class="orbit-line line-two" />
    </div>
    <p class="eyebrow">{{ $t("app.tagline") }}</p>
    <h1 id="welcome-title">{{ $t("thread.emptyTitle") }}</h1>
    <p>{{ $t("thread.emptyBody") }}</p>
  </section>
</template>
