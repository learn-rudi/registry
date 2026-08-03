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

const sourceVideo = staticFile('media/intake-2026-06-16-9bd256dc/three-layer-ai-tech-stack-draft-v2-optimized.mp4');
export const appliedMotionDurationFrames = 2933;

const palette = {
  bg: '#0b0d0c',
  panel: 'rgba(17, 20, 19, 0.88)',
  panelStrong: 'rgba(14, 16, 15, 0.94)',
  ink: '#f3efe7',
  dim: '#aaa79d',
  faint: '#66645d',
  green: '#c9ff3a',
  terra: '#e86a33',
  gold: '#c9a24b',
  blue: '#74d6ff',
  violet: '#c9a7ff',
  hair: 'rgba(243, 239, 231, 0.16)',
  softHair: 'rgba(243, 239, 231, 0.08)'
};

const font = {
  fontFamily: 'Inter, Arial, sans-serif',
  letterSpacing: 0
};

function clampInterpolate(frame, input, output) {
  return interpolate(frame, input, output, {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp'
  });
}

function progress(frame, start, duration) {
  return clampInterpolate(frame, [start, start + duration], [0, 1]);
}

function easeOutCubic(value) {
  return 1 - Math.pow(1 - value, 3);
}

function stageProgress(frame, start, end, fade = 18) {
  const enter = progress(frame, start, fade);
  const exit = 1 - progress(frame, end - fade, fade);
  return Math.max(0, Math.min(1, enter, exit));
}

function panelStyle(opacity, transform) {
  return {
    position: 'absolute',
    border: `1px solid ${palette.hair}`,
    background: `linear-gradient(145deg, ${palette.panelStrong}, ${palette.panel})`,
    boxShadow: '0 28px 80px rgba(0, 0, 0, 0.38)',
    opacity,
    transform
  };
}

function SourceStage() {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const shrink = easeOutCubic(progress(frame, 154, 44));
  const expand = spring({
    frame: frame - 2840,
    fps,
    config: {
      damping: 25,
      stiffness: 92,
      mass: 0.9
    }
  });
  const pip = Math.max(0, Math.min(1, shrink * (1 - expand)));
  const stageHeight = clampInterpolate(pip, [0, 1], [1920, 840]);
  const portraitHeight = clampInterpolate(pip, [0, 1], [1920, 780]);
  const portraitWidth = clampInterpolate(pip, [0, 1], [1080, 438]);
  const portraitTop = (stageHeight - portraitHeight) / 2;
  const portraitLeft = (1080 - portraitWidth) / 2;
  const bottomRadius = clampInterpolate(pip, [0, 1], [0, 28]);
  const border = clampInterpolate(pip, [0, 1], [0, 2]);
  const portraitRadius = clampInterpolate(pip, [0, 1], [0, 22]);
  const backdropBlur = clampInterpolate(pip, [0, 1], [0, 24]);
  const backdropScale = clampInterpolate(pip, [0, 1], [1, 1.08]);

  return (
    <AbsoluteFill style={{background: palette.bg}}>
      <Audio src={sourceVideo} endAt={appliedMotionDurationFrames} />
      <AbsoluteFill
        style={{
          opacity: pip * 0.34,
          filter: 'blur(30px)',
          transform: 'scale(1.08)',
          overflow: 'hidden'
        }}
      >
        <OffthreadVideo
          src={sourceVideo}
          muted
          endAt={appliedMotionDurationFrames}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          opacity: pip,
          background: 'linear-gradient(180deg, rgba(11, 13, 12, 0) 0%, rgba(11, 13, 12, 0.5) 54%, rgba(11, 13, 12, 0.82) 100%)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1080,
          height: stageHeight,
          transformOrigin: 'top left',
          borderRadius: `0 0 ${bottomRadius}px ${bottomRadius}px`,
          borderBottom: `${border}px solid rgba(243, 239, 231, 0.24)`,
          overflow: 'hidden',
          boxShadow: pip > 0.05 ? '0 34px 90px rgba(0, 0, 0, 0.56)' : 'none',
          zIndex: 5
        }}
      >
        <OffthreadVideo
          src={sourceVideo}
          muted
          endAt={appliedMotionDurationFrames}
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: 'center 16%',
            filter: `blur(${backdropBlur}px)`,
            transform: `scale(${backdropScale})`,
            opacity: 0.42 + pip * 0.34
          }}
        />
        <AbsoluteFill
          style={{
            opacity: pip,
            background: 'linear-gradient(90deg, rgba(11, 13, 12, 0.44) 0%, rgba(11, 13, 12, 0.1) 42%, rgba(11, 13, 12, 0.1) 58%, rgba(11, 13, 12, 0.44) 100%)'
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: portraitLeft,
            top: portraitTop,
            width: portraitWidth,
            height: portraitHeight,
            borderRadius: portraitRadius,
            overflow: 'hidden',
            boxShadow: pip > 0.05 ? '0 22px 70px rgba(0, 0, 0, 0.44)' : 'none',
            border: `${border}px solid rgba(243, 239, 231, 0.18)`,
            background: palette.bg
          }}
        >
          <OffthreadVideo
            src={sourceVideo}
            muted
            endAt={appliedMotionDurationFrames}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function OpeningTitle() {
  const frame = useCurrentFrame();
  const exit = 1 - progress(frame, 188, 18);

  return (
    <div
      style={{
        ...font,
        position: 'absolute',
        left: 72,
        right: 72,
        top: 168,
        zIndex: 12,
        opacity: exit,
        transform: `translateY(${interpolate(exit, [0, 1], [-18, 0])}px)`
      }}
    >
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 12,
          height: 54,
          padding: '0 18px',
          borderRadius: 5,
          background: 'rgba(11, 13, 12, 0.78)',
          border: `1px solid ${palette.hair}`,
          color: palette.green,
          fontSize: 16,
          fontWeight: 900,
          textTransform: 'uppercase'
        }}
      >
        <span style={{width: 9, height: 9, borderRadius: 9, background: palette.green}} />
        Transcript motion map
      </div>
      <div
        style={{
          marginTop: 18,
          maxWidth: 650,
          color: palette.ink,
          fontFamily: 'Georgia, serif',
          fontSize: 58,
          lineHeight: 0.96,
          textShadow: '0 3px 22px rgba(0, 0, 0, 0.42)'
        }}
      >
        Build your AI tool stack.
      </div>
      <div
        style={{
          marginTop: 18,
          maxWidth: 560,
          color: palette.ink,
          fontSize: 24,
          lineHeight: 1.18,
          fontWeight: 800,
          textShadow: '0 3px 18px rgba(0, 0, 0, 0.44)'
        }}
      >
        What tools should you focus on?
      </div>
    </div>
  );
}

function LayerStackCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 198, 1238);
  const workflowIn = easeOutCubic(progress(frame, 690, 30));
  const cardHeight = interpolate(workflowIn, [0, 1], [760, 482]);
  const headingSize = interpolate(workflowIn, [0, 1], [42, 38]);
  const rowGap = interpolate(workflowIn, [0, 1], [18, 14]);
  const rowHeight = interpolate(workflowIn, [0, 1], [128, 86]);
  const rows = [
    {
      number: '01',
      label: 'Search / retrieval',
      detail: 'Find, recall, and query information.',
      color: palette.blue,
      at: 328
    },
    {
      number: '02',
      label: 'Reasoning / synthesis',
      detail: 'Make sense of what you gathered.',
      color: palette.gold,
      at: 600
    },
    {
      number: '03',
      label: 'Creation',
      detail: 'Build assets from the information.',
      color: palette.green,
      at: 1054
    }
  ];

  return (
    <div
      style={{
        ...panelStyle(show, `translateX(${interpolate(show, [0, 1], [-38, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 876,
        height: cardHeight,
        padding: 26,
        zIndex: 4
      }}
    >
      <div style={{color: palette.green, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>01 / framework</div>
      <div style={{color: palette.ink, fontSize: headingSize, lineHeight: 1.02, fontWeight: 900, marginTop: 14}}>
        The transcript gives us three layers.
      </div>
      <div style={{display: 'grid', gap: rowGap, marginTop: 22}}>
        {rows.map((row, index) => {
          const rowIn = easeOutCubic(progress(frame, row.at, 26));
          return (
            <div
              key={row.label}
              style={{
                display: 'grid',
                gridTemplateColumns: '52px 1fr',
                gap: 16,
                minHeight: rowHeight,
                padding: 14,
                border: `1px solid ${palette.softHair}`,
                background: rowIn > 0.6 ? 'rgba(243, 239, 231, 0.055)' : 'rgba(243, 239, 231, 0.025)',
                transform: `translateX(${interpolate(rowIn, [0, 1], [-18, 0])}px)`,
                opacity: 0.44 + rowIn * 0.56
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 44,
                  color: palette.bg,
                  background: row.color,
                  fontSize: 15,
                  fontWeight: 1000
                }}
              >
                {row.number}
              </div>
              <div>
                <div style={{display: 'flex', justifyContent: 'space-between', gap: 12}}>
                  <span style={{color: palette.ink, fontSize: 24, lineHeight: 1.05, fontWeight: 1000}}>{row.label}</span>
                  <span style={{color: row.color, fontSize: 13, fontWeight: 1000, textTransform: 'uppercase'}}>layer {index + 1}</span>
                </div>
                <div style={{color: palette.dim, fontSize: 18, lineHeight: 1.16, fontWeight: 760, marginTop: 6}}>
                  {row.detail}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WorkflowLineCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 690, 1540);
  const draw = easeOutCubic(progress(frame, 704, 82));
  const points = [
    [96, 220],
    [318, 122],
    [540, 202],
    [778, 78]
  ];
  const path = points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  const labels = [
    ['search', 64, 284, palette.blue],
    ['synthesize', 266, 70, palette.gold],
    ['create', 504, 268, palette.green],
    ['reuse', 744, 60, palette.violet]
  ];

  return (
    <div
      style={{
        ...panelStyle(show, `translateY(${interpolate(show, [0, 1], [42, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 1384,
        height: 410,
        padding: 28,
        zIndex: 4
      }}
    >
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 24}}>
        <div>
          <div style={{color: palette.green, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>02 / motion layer</div>
          <div style={{color: palette.ink, fontSize: 39, lineHeight: 1.02, fontWeight: 900, marginTop: 10}}>
            Start with the job, then choose the tool.
          </div>
        </div>
        <div style={{color: palette.dim, fontSize: 17, lineHeight: 1.22, width: 278, fontWeight: 760}}>
          The speaker stays present while the graphic carries the abstract framework.
        </div>
      </div>
      <svg width="900" height="226" viewBox="0 0 900 250" style={{marginTop: 24, display: 'block'}}>
        <path
          d={path}
          fill="none"
          stroke={palette.green}
          strokeWidth="7"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - draw}
        />
        {points.map(([x, y], index) => {
          const dot = progress(frame, 728 + index * 20, 16);
          const fill = labels[index][3];
          return (
            <g key={`${x}-${y}`} opacity={dot}>
              <circle cx={x} cy={y} r="18" fill={fill} />
              <circle cx={x} cy={y} r="28" fill="none" stroke={fill} opacity="0.22" strokeWidth="5" />
            </g>
          );
        })}
        {labels.map(([label, x, y, color], index) => {
          const textIn = progress(frame, 748 + index * 20, 16);
          return (
            <text
              key={label}
              x={x}
              y={y}
              fill={color}
              fontFamily="Inter, Arial, sans-serif"
              fontSize="28"
              fontWeight="1000"
              opacity={textIn}
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function ToolMapCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 1540, 2370);
  const rows = [
    ['Search', 'Perplexity', palette.blue, 1578],
    ['Synthesis', 'ChatGPT / Claude / Gemini', palette.gold, 1786],
    ['Creation', 'DALL-E / Nano Banana / Gamma', palette.green, 2002],
    ['Creative build', 'Midjourney / Lovable', palette.terra, 2194]
  ];

  return (
    <div
      style={{
        ...panelStyle(show, `translateX(${interpolate(show, [0, 1], [46, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 874,
        height: 492,
        padding: 28,
        zIndex: 4
      }}
    >
      <div style={{color: palette.green, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>03 / tool examples</div>
      <div style={{color: palette.ink, fontSize: 38, lineHeight: 1.04, fontWeight: 900, marginTop: 12}}>
        Map each tool to the layer it serves.
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginTop: 24}}>
        {rows.map(([layer, tools, color, at]) => {
          const rowIn = easeOutCubic(progress(frame, at, 22));
          return (
            <div
              key={layer}
              style={{
                display: 'grid',
                gridTemplateColumns: '116px 1fr',
                alignItems: 'center',
                gap: 14,
                minHeight: 122,
                padding: '14px 16px',
                border: `1px solid ${palette.softHair}`,
                background: 'rgba(243, 239, 231, 0.044)',
                opacity: rowIn,
                transform: `translateY(${interpolate(rowIn, [0, 1], [18, 0])}px)`
              }}
            >
              <div style={{color, fontSize: 14, fontWeight: 1000, textTransform: 'uppercase'}}>{layer}</div>
              <div style={{color: palette.ink, fontSize: 22, lineHeight: 1.08, fontWeight: 920}}>{tools}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ToolDecisionCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 1710, 2458);
  const jobs = [
    ['Need facts?', 'Search layer', palette.blue, 1744],
    ['Need judgment?', 'Synthesis layer', palette.gold, 1810],
    ['Need an asset?', 'Creation layer', palette.green, 1900],
    ['Need an app?', 'Creative build', palette.terra, 2150]
  ];

  return (
    <div
      style={{
        ...panelStyle(show, `translateY(${interpolate(show, [0, 1], [42, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 1394,
        height: 392,
        padding: 28,
        zIndex: 4
      }}
    >
      <div style={{display: 'flex', justifyContent: 'space-between', gap: 28, alignItems: 'start'}}>
        <div>
          <div style={{color: palette.green, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>tool selection rule</div>
          <div style={{color: palette.ink, fontSize: 38, lineHeight: 1.02, fontWeight: 900, marginTop: 10}}>
            Pick the job first. Then pick the tool.
          </div>
        </div>
        <div style={{color: palette.dim, fontSize: 17, lineHeight: 1.22, width: 286, fontWeight: 760}}>
          This keeps the graphic tied to the words instead of turning into a random feature list.
        </div>
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginTop: 24}}>
        {jobs.map(([question, layer, color, at]) => {
          const tileIn = easeOutCubic(progress(frame, at, 18));
          return (
            <div
              key={question}
              style={{
                minHeight: 86,
                padding: '16px 20px',
                border: `1px solid ${palette.softHair}`,
                background: 'rgba(243, 239, 231, 0.046)',
                opacity: tileIn,
                transform: `translateY(${interpolate(tileIn, [0, 1], [18, 0])}px)`
              }}
            >
              <div style={{color, fontSize: 14, fontWeight: 1000, textTransform: 'uppercase'}}>{question}</div>
              <div style={{color: palette.ink, fontSize: 25, lineHeight: 1.04, fontWeight: 1000, marginTop: 8}}>
                {layer}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StorageCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 2614, 2914);
  const steps = [
    ['store data', 2686],
    ['search it', 2814],
    ['synthesize it', 2862],
    ['create from it', 2882]
  ];

  return (
    <div
      style={{
        ...panelStyle(show, `translateY(${interpolate(show, [0, 1], [34, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 1050,
        height: 560,
        padding: 34,
        zIndex: 7
      }}
    >
      <div style={{color: palette.violet, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>04 / next layer</div>
      <div style={{color: palette.ink, fontSize: 46, lineHeight: 1.02, fontWeight: 900, marginTop: 14}}>
        Storage is the layer that makes the stack reusable.
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginTop: 34}}>
        {steps.map(([step, at], index) => {
          const stepIn = progress(frame, at, 18);
          return (
            <div
              key={step}
              style={{
                minHeight: 120,
                display: 'grid',
                placeItems: 'center',
                border: `1px solid ${palette.softHair}`,
                color: index === 0 ? palette.violet : palette.ink,
                background: index === 0 ? 'rgba(201, 167, 255, 0.09)' : 'rgba(243, 239, 231, 0.04)',
                fontSize: 21,
                lineHeight: 1.05,
                fontWeight: 1000,
                textAlign: 'center',
                opacity: stepIn
              }}
            >
              {step}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ClosingLine() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 2874, 2926);

  return (
    <AbsoluteFill style={{opacity: show, zIndex: 8, pointerEvents: 'none'}}>
      <AbsoluteFill
        style={{
          background: 'linear-gradient(0deg, rgba(11, 13, 12, 0.86) 0%, rgba(11, 13, 12, 0.52) 34%, transparent 64%)'
        }}
      />
      <div
        style={{
          ...font,
          position: 'absolute',
          left: 72,
          right: 72,
          bottom: 180,
          transform: `translateY(${interpolate(show, [0, 1], [30, 0])}px)`
        }}
      >
        <div style={{color: palette.green, fontSize: 17, fontWeight: 900, textTransform: 'uppercase'}}>Motion rule</div>
        <div style={{color: palette.ink, fontFamily: 'Georgia, serif', fontSize: 58, lineHeight: 0.98, marginTop: 18, textShadow: '0 5px 28px rgba(0, 0, 0, 0.86)'}}>
          Choose tools by the job they do.
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function AppliedMotionExample() {
  return (
    <AbsoluteFill style={{background: palette.bg}}>
      <SourceStage />
      <OpeningTitle />
      <LayerStackCard />
      <WorkflowLineCard />
      <ToolMapCard />
      <ToolDecisionCard />
      <StorageCard />
      <ClosingLine />
    </AbsoluteFill>
  );
}
