import React from 'react';
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig
} from 'remotion';

const source = staticFile('media/motion-proof/source.mp4');

function clampInterpolate(frame, input, output) {
  return interpolate(frame, input, output, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
}

function reveal(frame, start, duration = 18) {
  return clampInterpolate(frame, [start, start + duration], [0, 1]);
}

function getLayout(width, height) {
  const isVertical = height > width;

  return {
    isVertical,
    pip: isVertical
      ? {scale: 0.33, x: 260, y: 540, radius: 22, border: 2}
      : {scale: 0.28, x: 654, y: 328, radius: 18, border: 2},
    badge: isVertical
      ? {top: 54, left: 54}
      : {top: 38, left: 44},
    stat: isVertical
      ? {left: 58, top: 246, width: 440, height: 292, padding: 26}
      : {left: 92, top: 168, width: 520, height: 318, padding: 30},
    code: isVertical
      ? {left: 58, top: 590, width: 604, height: 282, padding: 26}
      : {right: 98, top: 154, width: 600, height: 286, padding: 28},
    waveform: isVertical
      ? {left: 58, top: 920, width: 560, height: 174, padding: 24}
      : {left: 116, bottom: 98, width: 652, height: 190, padding: 28},
    review: isVertical
      ? {left: 58, top: 1136, width: 470, height: 240, padding: 24}
      : {right: 112, bottom: 84, width: 512, height: 250, padding: 28},
    closing: isVertical
      ? {left: 58, right: 58, top: 128}
      : {left: 132, right: 132, top: 112}
  };
}

const panel = {
  position: 'absolute',
  border: '1px solid rgba(150, 210, 255, 0.16)',
  background: 'linear-gradient(135deg, rgba(8, 13, 17, 0.94), rgba(5, 8, 12, 0.88))',
  boxShadow: '0 28px 80px rgba(0, 0, 0, 0.36), inset 0 0 40px rgba(82, 185, 255, 0.05)',
  backdropFilter: 'blur(8px)'
};

const font = {
  fontFamily: 'Inter, Arial, sans-serif',
  letterSpacing: 0
};

function SourceVideoStage() {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const layout = getLayout(width, height);
  const shrink = spring({
    frame: frame - 54,
    fps,
    config: {
      damping: 22,
      stiffness: 92,
      mass: 0.9
    }
  });
  const expand = spring({
    frame: frame - 390,
    fps,
    config: {
      damping: 24,
      stiffness: 90,
      mass: 0.9
    }
  });
  const pip = Math.max(0, Math.min(1, shrink - expand));
  const scale = interpolate(pip, [0, 1], [1, layout.pip.scale]);
  const x = interpolate(pip, [0, 1], [0, layout.pip.x]);
  const y = interpolate(pip, [0, 1], [0, layout.pip.y]);
  const radius = interpolate(pip, [0, 1], [0, layout.pip.radius]);
  const border = interpolate(pip, [0, 1], [0, layout.pip.border]);

  return (
    <AbsoluteFill>
      <Audio src={source} endAt={480} />
      <AbsoluteFill
        style={{
          transform: `translate(${x}px, ${y}px) scale(${scale})`,
          transformOrigin: 'center center',
          borderRadius: radius,
          border: `${border}px solid rgba(255, 255, 255, 0.28)`,
          boxShadow: pip > 0.03 ? '0 24px 70px rgba(0, 0, 0, 0.54)' : 'none',
          overflow: 'hidden',
          zIndex: 8
        }}
      >
        <OffthreadVideo
          src={source}
          muted
          endAt={480}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover'
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function BadgeStack() {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const layout = getLayout(width, height);
  const labels = ['TRANSCRIPT SYNCED', 'CODED GRAPHICS', 'PIP AUTO-LAYOUT'];

  return (
    <div style={{position: 'absolute', top: layout.badge.top, left: layout.badge.left, zIndex: 12}}>
      {labels.map((label, index) => {
        const progress = reveal(frame, 70 + index * 8, 12);
        return (
          <div
            key={label}
            style={{
              ...font,
              height: 32,
              marginBottom: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '0 12px',
              borderRadius: 4,
              color: 'rgba(234, 248, 255, 0.92)',
              fontSize: 14,
              fontWeight: 800,
              opacity: progress,
              transform: `translateX(${interpolate(progress, [0, 1], [-18, 0])}px)`,
              background: 'rgba(10, 19, 25, 0.76)',
              border: '1px solid rgba(112, 211, 255, 0.28)'
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 8,
                background: '#69d9ff',
                boxShadow: '0 0 18px rgba(105, 217, 255, 0.9)'
              }}
            />
            {label}
          </div>
        );
      })}
    </div>
  );
}

function StatBars() {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const layout = getLayout(width, height);
  const progress = reveal(frame, 94, 28);
  const bars = [0.28, 0.42, 0.55, 0.86, 0.38];
  const barWidth = layout.isVertical ? 38 : 48;
  const barHeight = layout.isVertical ? 108 : 122;

  return (
    <div
      style={{
        ...panel,
        left: layout.stat.left,
        top: layout.stat.top,
        width: layout.stat.width,
        height: layout.stat.height,
        padding: layout.stat.padding,
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [28, 0])}px)`,
        zIndex: 4
      }}
    >
      <div style={{...font, color: '#89a8b5', fontSize: 13, fontWeight: 800}}>STATE OF THE EDIT</div>
      <div style={{...font, color: 'white', fontSize: layout.isVertical ? 38 : 46, fontWeight: 900, lineHeight: 1.02, marginTop: 12}}>
        Motion graphics
        <br />
        from code
      </div>
      <div style={{display: 'flex', alignItems: 'end', gap: layout.isVertical ? 18 : 24, height: barHeight + 4, marginTop: layout.isVertical ? 28 : 34}}>
        {bars.map((bar, index) => {
          const local = reveal(frame, 118 + index * 6, 18);
          return (
            <div key={bar} style={{width: barWidth, height: barHeight, display: 'flex', alignItems: 'end'}}>
              <div
                style={{
                  width: '100%',
                  height: `${Math.max(7, bar * (barHeight - 4) * local)}px`,
                  borderRadius: 3,
                  background: index === 3
                    ? 'linear-gradient(180deg, #bff5ff, #54d7ff)'
                    : 'linear-gradient(180deg, rgba(147, 185, 203, 0.42), rgba(147, 185, 203, 0.14))',
                  boxShadow: index === 3 ? '0 0 26px rgba(84, 215, 255, 0.58)' : 'none'
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CodePanel() {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const layout = getLayout(width, height);
  const progress = reveal(frame, 136, 24);
  const lines = [
    'scene("PIP").at(1.8).spring()',
    'bars.from(data).stagger(6)',
    'waveform.sync(words)',
    'reviewGrid.check(frames)',
    'render("motion-proof.mp4")'
  ];

  return (
    <div
      style={{
        ...panel,
        ...layout.code,
        opacity: progress,
        transform: `translateX(${interpolate(progress, [0, 1], [42, 0])}px)`,
        zIndex: 3
      }}
    >
      <div style={{...font, color: '#6bdfff', fontSize: 13, fontWeight: 900, marginBottom: 18}}>MOTION PLAN</div>
      {lines.map((line, index) => {
        const local = reveal(frame, 152 + index * 9, 10);
        return (
          <div
            key={line}
            style={{
              ...font,
              display: 'flex',
              alignItems: 'center',
              height: 36,
              opacity: local,
              color: index === 4 ? '#ffe07a' : 'rgba(230, 246, 255, 0.86)',
              fontSize: layout.isVertical ? 18 : 21,
              fontWeight: 700,
              transform: `translateX(${interpolate(local, [0, 1], [-20, 0])}px)`
            }}
          >
            <span style={{color: 'rgba(126, 151, 160, 0.58)', width: 42}}>{String(index + 1).padStart(2, '0')}</span>
            {line}
          </div>
        );
      })}
    </div>
  );
}

function WaveformCard() {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const layout = getLayout(width, height);
  const progress = reveal(frame, 206, 24);
  const samples = Array.from({length: 46}, (_, index) => {
    const wave = Math.sin(index * 0.78) * 0.45 + Math.sin(index * 1.91) * 0.25;
    return Math.abs(wave) + 0.16;
  });

  return (
    <div
      style={{
        ...panel,
        ...layout.waveform,
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [32, 0])}px)`,
        zIndex: 3
      }}
    >
      <div style={{...font, color: '#e6f6ff', fontSize: layout.isVertical ? 23 : 28, fontWeight: 900}}>Voice and captions are timed</div>
      <div style={{display: 'flex', alignItems: 'center', gap: layout.isVertical ? 4 : 5, height: 82, marginTop: layout.isVertical ? 18 : 24}}>
        {samples.map((sample, index) => {
          const local = reveal(frame, 226 + index * 2, 8);
          return (
            <div
              key={index}
              style={{
                width: layout.isVertical ? 6 : 8,
                height: `${12 + sample * 62 * local}px`,
                borderRadius: 8,
                background: index % 5 === 0 ? '#ffe076' : '#66d9ff',
                opacity: 0.45 + local * 0.55,
                boxShadow: index % 5 === 0 ? '0 0 14px rgba(255, 224, 118, 0.42)' : 'none'
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReviewGrid() {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const layout = getLayout(width, height);
  const progress = reveal(frame, 276, 24);
  const cells = Array.from({length: 12}, (_, index) => index);

  return (
    <div
      style={{
        ...panel,
        ...layout.review,
        opacity: progress,
        transform: `translateY(${interpolate(progress, [0, 1], [34, 0])}px)`,
        zIndex: 3
      }}
    >
      <div style={{...font, color: '#e6f6ff', fontSize: layout.isVertical ? 23 : 27, fontWeight: 900, marginBottom: 20}}>
        QA frame review
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: layout.isVertical ? 10 : 12}}>
        {cells.map((cell) => {
          const local = reveal(frame, 294 + cell * 5, 8);
          return (
            <div
              key={cell}
              style={{
                height: layout.isVertical ? 39 : 43,
                borderRadius: 4,
                background: 'rgba(91, 128, 144, 0.16)',
                border: '1px solid rgba(137, 204, 232, 0.16)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: local > 0.65 ? '#64ffb8' : 'rgba(137, 204, 232, 0.24)',
                fontSize: 16,
                fontWeight: 900
              }}
            >
              {local > 0.65 ? 'OK' : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClosingPipeline() {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();
  const layout = getLayout(width, height);
  const progress = reveal(frame, 350, 20);
  const items = ['Prompt', 'Script', 'Avatar', 'Graphics', 'Render'];
  const itemStyle = {
    width: layout.isVertical ? 176 : 198,
    height: layout.isVertical ? 76 : 86,
    borderRadius: 5,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#e9fbff',
    fontSize: layout.isVertical ? 18 : 20,
    fontWeight: 900,
    background: 'rgba(10, 18, 24, 0.86)',
    border: '1px solid rgba(255, 224, 118, 0.28)'
  };

  return (
    <div
      style={{
        ...font,
        position: 'absolute',
        left: layout.closing.left,
        right: layout.closing.right,
        top: layout.closing.top,
        opacity: progress,
        zIndex: 2
      }}
    >
      <div style={{color: 'white', fontSize: layout.isVertical ? 42 : 52, fontWeight: 950, lineHeight: 1.04}}>
        One prompt in. A motion pass out.
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: layout.isVertical ? 'wrap' : 'nowrap',
          gap: layout.isVertical ? 12 : 14,
          marginTop: layout.isVertical ? 30 : 48,
          maxWidth: layout.isVertical ? 390 : 'none'
        }}
      >
        {items.map((item, index) => {
          const local = reveal(frame, 368 + index * 8, 12);
          return (
            <React.Fragment key={item}>
              <div
                style={{
                  ...itemStyle,
                  opacity: local,
                  transform: `scale(${interpolate(local, [0, 1], [0.88, 1])})`
                }}
              >
                {item}
              </div>
              {!layout.isVertical && index < items.length - 1 ? (
                <div style={{width: 34, height: 2, background: 'rgba(255, 224, 118, 0.42)', opacity: local}} />
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function MotionProof() {
  const frame = useCurrentFrame();
  const fadeToGraphics = reveal(frame, 56, 22);
  const fadeBack = reveal(frame, 394, 24);
  const graphicsOpacity = Math.max(0, Math.min(1, fadeToGraphics - fadeBack));

  return (
    <AbsoluteFill style={{backgroundColor: '#05080b', overflow: 'hidden'}}>
      <SourceVideoStage />
      <AbsoluteFill
        style={{
          opacity: graphicsOpacity,
          background:
            'linear-gradient(135deg, #071015 0%, #09151a 36%, #030506 100%)',
          zIndex: 1
        }}
      />
      <BadgeStack />
      <StatBars />
      <CodePanel />
      <WaveformCard />
      <ReviewGrid />
      <ClosingPipeline />
    </AbsoluteFill>
  );
}
