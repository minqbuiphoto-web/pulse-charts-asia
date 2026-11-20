export default function AnimationStudio() {
  return (
    <iframe
      title="Animation Studio 2D"
      src="/animation/index.html"
      style={{
        width: "100%",
        height: "calc(100dvh - 72px)",
        minHeight: 640,
        border: 0,
        display: "block",
      }}
    />
  );
}
