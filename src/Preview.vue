<script setup lang="ts">
const props = defineProps<{
  src: string;
}>();
</script>

<template>
  <div class="code-group-preview">
    <iframe
      :src="decodeURIComponent(props.src)"
      class="code-group-preview-frame"
    />
  </div>
</template>

<style lang="scss">
.code-group-preview {
  height: 384px;
  margin-top: 16px;
  overflow: hidden;
  border-bottom: 1px solid var(--vp-code-tab-divider);
  margin-left: -24px;
  margin-right: -24px;

  .code-group-preview-frame {
    width: 100%;
    height: 100%;
    border: none;
  }
}

.code-group-preview ~ .vp-code-group {
  margin-top: 0;
}

@media (min-width: 640px) {
  .code-group-preview {
    border-radius: 8px 8px 0 0;
    margin-right: 0;
    margin-left: 0;
  }

  .code-group-preview ~ .vp-code-group {
    .tabs {
      border-radius: 0;
    }
  }
}
</style>
