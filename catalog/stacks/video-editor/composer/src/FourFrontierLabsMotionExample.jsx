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

const sourceVideo = staticFile('media/intake-2026-06-17-9cc68587/four-frontier-ai-labs-draft-v2-optimized.mp4');
export const fourFrontierDurationFrames = 1367;

const palette = {
  bg: '#0a0d0e',
  panel: 'rgba(16, 19, 20, 0.88)',
  panelStrong: 'rgba(11, 14, 15, 0.94)',
  ink: '#f5f0e7',
  dim: '#b8b1a5',
  faint: '#6f6a62',
  green: '#c9ff3a',
  blue: '#73d5ff',
  gold: '#d7ad4f',
  coral: '#ff7c55',
  violet: '#cba8ff',
  hair: 'rgba(245, 240, 231, 0.16)',
  softHair: 'rgba(245, 240, 231, 0.08)'
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
  const shrink = easeOutCubic(progress(frame, 152, 40));
  const expand = spring({
    frame: frame - 1260,
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
      <Audio src={sourceVideo} endAt={fourFrontierDurationFrames} />
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
          endAt={fourFrontierDurationFrames}
          style={{width: '100%', height: '100%', objectFit: 'cover'}}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          opacity: pip,
          background: 'linear-gradient(180deg, rgba(10, 13, 14, 0) 0%, rgba(10, 13, 14, 0.5) 54%, rgba(10, 13, 14, 0.84) 100%)'
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
          borderBottom: `${border}px solid rgba(245, 240, 231, 0.24)`,
          overflow: 'hidden',
          boxShadow: pip > 0.05 ? '0 34px 90px rgba(0, 0, 0, 0.56)' : 'none',
          zIndex: 5
        }}
      >
        <OffthreadVideo
          src={sourceVideo}
          muted
          endAt={fourFrontierDurationFrames}
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
            background: 'linear-gradient(90deg, rgba(10, 13, 14, 0.44) 0%, rgba(10, 13, 14, 0.1) 42%, rgba(10, 13, 14, 0.1) 58%, rgba(10, 13, 14, 0.44) 100%)'
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
            border: `${border}px solid rgba(245, 240, 231, 0.18)`,
            background: palette.bg
          }}
        >
          <OffthreadVideo
            src={sourceVideo}
            muted
            endAt={fourFrontierDurationFrames}
            style={{width: '100%', height: '100%', objectFit: 'cover'}}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
}

function OpeningTitle() {
  const frame = useCurrentFrame();
  const exit = 1 - progress(frame, 170, 20);
  const labs = [
    ['Anthropic', palette.blue, 24],
    ['OpenAI', palette.green, 54],
    ['Google', palette.gold, 84],
    ['xAI', palette.coral, 112]
  ];

  return (
    <div
      style={{
        ...font,
        position: 'absolute',
        left: 72,
        right: 72,
        top: 158,
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
          background: 'rgba(10, 13, 14, 0.78)',
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
          maxWidth: 680,
          color: palette.ink,
          fontFamily: 'Georgia, serif',
          fontSize: 60,
          lineHeight: 0.96,
          textShadow: '0 3px 22px rgba(0, 0, 0, 0.46)'
        }}
      >
        Four frontier AI labs.
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, width: 570, marginTop: 28}}>
        {labs.map(([label, color, at]) => {
          const labIn = easeOutCubic(progress(frame, at, 18));
          return (
            <div
              key={label}
              style={{
                height: 64,
                display: 'flex',
                alignItems: 'center',
                padding: '0 18px',
                border: `1px solid ${palette.hair}`,
                background: 'rgba(10, 13, 14, 0.76)',
                color,
                fontSize: 23,
                fontWeight: 1000,
                opacity: labIn,
                transform: `translateY(${interpolate(labIn, [0, 1], [14, 0])}px)`
              }}
            >
              {label}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LabsCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 178, 555);
  const labs = [
    ['Anthropic', 'frontier lab', palette.blue, 205],
    ['OpenAI', 'frontier lab', palette.green, 235],
    ['Google', 'frontier lab', palette.gold, 265],
    ['xAI', 'frontier lab', palette.coral, 295]
  ];

  return (
    <div
      style={{
        ...panelStyle(show, `translateX(${interpolate(show, [0, 1], [-38, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 876,
        height: 360,
        padding: 28,
        zIndex: 4
      }}
    >
      <div style={{color: palette.green, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>01 / named set</div>
      <div style={{color: palette.ink, fontSize: 42, lineHeight: 1.02, fontWeight: 900, marginTop: 12}}>
        The frontier labs build the models.
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14, marginTop: 24}}>
        {labs.map(([label, detail, color, at]) => {
          const labIn = easeOutCubic(progress(frame, at, 18));
          return (
            <div
              key={label}
              style={{
                minHeight: 92,
                padding: '16px 18px',
                border: `1px solid ${palette.softHair}`,
                background: 'rgba(245, 240, 231, 0.044)',
                opacity: labIn,
                transform: `translateY(${interpolate(labIn, [0, 1], [18, 0])}px)`
              }}
            >
              <div style={{color, fontSize: 14, fontWeight: 1000, textTransform: 'uppercase'}}>{detail}</div>
              <div style={{color: palette.ink, fontSize: 29, lineHeight: 1.04, fontWeight: 1000, marginTop: 8}}>{label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IndustryBuildsCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 250, 825);
  const draw = easeOutCubic(progress(frame, 338, 62));
  const productIn = easeOutCubic(progress(frame, 405, 24));
  const serviceIn = easeOutCubic(progress(frame, 452, 24));
  const workflowIn = easeOutCubic(progress(frame, 500, 24));

  return (
    <div
      style={{
        ...panelStyle(show, `translateY(${interpolate(show, [0, 1], [42, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 1272,
        height: 510,
        padding: 28,
        zIndex: 4
      }}
    >
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 24}}>
        <div>
          <div style={{color: palette.green, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>02 / industry structure</div>
          <div style={{color: palette.ink, fontSize: 39, lineHeight: 1.02, fontWeight: 900, marginTop: 10}}>
            Everyone else builds with AI.
          </div>
        </div>
        <div style={{color: palette.dim, fontSize: 17, lineHeight: 1.22, width: 282, fontWeight: 760}}>
          The distinction is between building the model and building on top of the model.
        </div>
      </div>
      <svg width="904" height="284" viewBox="0 0 904 284" style={{display: 'block', marginTop: 26}}>
        <rect x="36" y="72" width="250" height="124" rx="10" fill="rgba(115, 213, 255, 0.08)" stroke={palette.softHair} />
        <text x="64" y="122" fill={palette.blue} fontFamily="Inter, Arial, sans-serif" fontSize="18" fontWeight="1000">
          FRONTIER MODELS
        </text>
        <text x="64" y="160" fill={palette.ink} fontFamily="Inter, Arial, sans-serif" fontSize="29" fontWeight="1000">
          model layer
        </text>
        <path
          d="M 304 134 C 398 110, 454 96, 542 80"
          fill="none"
          stroke={palette.green}
          strokeWidth="6"
          strokeLinecap="round"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - draw}
        />
        <path
          d="M 304 142 C 410 142, 470 142, 548 142"
          fill="none"
          stroke={palette.gold}
          strokeWidth="6"
          strokeLinecap="round"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - draw}
        />
        <path
          d="M 304 150 C 394 176, 464 196, 542 210"
          fill="none"
          stroke={palette.coral}
          strokeWidth="6"
          strokeLinecap="round"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - draw}
        />
        {[
          ['tools', 570, 38, palette.green, productIn],
          ['services', 602, 112, palette.gold, serviceIn],
          ['workflows', 558, 184, palette.coral, workflowIn]
        ].map(([label, x, y, color, opacity]) => (
          <g key={label} opacity={opacity}>
            <rect x={x} y={y} width="258" height="58" rx="8" fill="rgba(245, 240, 231, 0.052)" stroke={palette.softHair} />
            <text x={x + 24} y={y + 38} fill={color} fontFamily="Inter, Arial, sans-serif" fontSize="24" fontWeight="1000">
              {label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function PoweredByCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 626, 1048);
  const rows = [
    ['AI-powered product', palette.green, 648],
    ['frontier model', palette.blue, 694],
    ['frontier lab', palette.gold, 744]
  ];

  return (
    <div
      style={{
        ...panelStyle(show, `translateX(${interpolate(show, [0, 1], [46, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 876,
        height: 410,
        padding: 28,
        zIndex: 4
      }}
    >
      <div style={{color: palette.green, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>03 / powered by</div>
      <div style={{color: palette.ink, fontSize: 39, lineHeight: 1.04, fontWeight: 900, marginTop: 12}}>
        "AI-powered" usually has a model underneath.
      </div>
      <div style={{display: 'grid', gridTemplateColumns: '1fr 54px 1fr 54px 1fr', alignItems: 'center', gap: 12, marginTop: 30}}>
        {rows.map(([label, color, at], index) => {
          const rowIn = easeOutCubic(progress(frame, at, 20));
          return (
            <React.Fragment key={label}>
              <div
                style={{
                  minHeight: 122,
                  display: 'grid',
                  alignContent: 'center',
                  padding: '18px 18px',
                  border: `1px solid ${palette.softHair}`,
                  background: 'rgba(245, 240, 231, 0.046)',
                  opacity: rowIn,
                  transform: `translateY(${interpolate(rowIn, [0, 1], [18, 0])}px)`
                }}
              >
                <div style={{color, fontSize: 14, fontWeight: 1000, textTransform: 'uppercase'}}>layer {index + 1}</div>
                <div style={{color: palette.ink, fontSize: 25, lineHeight: 1.04, fontWeight: 1000, marginTop: 10}}>{label}</div>
              </div>
              {index < rows.length - 1 ? (
                <div style={{color: palette.faint, fontSize: 32, fontWeight: 1000, textAlign: 'center', opacity: progress(frame, at + 24, 14)}}>{'->'}</div>
              ) : null}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function VendorEvaluationCard() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 850, 1264);
  const checks = [
    ['Which model?', 'Find the underlying model.', palette.blue, 880],
    ['What capability?', 'Match capability to the model.', palette.gold, 930],
    ['What behavior?', 'Expect product behavior to follow it.', palette.green, 980]
  ];
  const line = easeOutCubic(progress(frame, 1035, 70));

  return (
    <div
      style={{
        ...panelStyle(show, `translateY(${interpolate(show, [0, 1], [42, 0])}px)`),
        ...font,
        left: 56,
        right: 56,
        top: 1310,
        height: 468,
        padding: 28,
        zIndex: 4
      }}
    >
      <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 28}}>
        <div>
          <div style={{color: palette.green, fontSize: 16, fontWeight: 900, textTransform: 'uppercase'}}>vendor evaluation clue</div>
          <div style={{color: palette.ink, fontSize: 38, lineHeight: 1.02, fontWeight: 900, marginTop: 10}}>
            Ask what model is underneath.
          </div>
        </div>
        <div style={{color: palette.dim, fontSize: 17, lineHeight: 1.22, width: 302, fontWeight: 760}}>
          Model choice shapes capability, behavior, and limits.
        </div>
      </div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 26}}>
        {checks.map(([question, detail, color, at]) => {
          const checkIn = easeOutCubic(progress(frame, at, 18));
          return (
            <div
              key={question}
              style={{
                minHeight: 116,
                padding: '16px 18px',
                border: `1px solid ${palette.softHair}`,
                background: 'rgba(245, 240, 231, 0.046)',
                opacity: checkIn,
                transform: `translateY(${interpolate(checkIn, [0, 1], [18, 0])}px)`
              }}
            >
              <div style={{color, fontSize: 15, fontWeight: 1000, textTransform: 'uppercase'}}>{question}</div>
              <div style={{color: palette.ink, fontSize: 21, lineHeight: 1.08, fontWeight: 900, marginTop: 10}}>{detail}</div>
            </div>
          );
        })}
      </div>
      <svg width="904" height="92" viewBox="0 0 904 92" style={{display: 'block', marginTop: 24}}>
        <path d="M 42 48 L 842 48" stroke={palette.softHair} strokeWidth="4" strokeLinecap="round" />
        <path
          d="M 42 48 L 842 48"
          stroke={palette.green}
          strokeWidth="8"
          strokeLinecap="round"
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - line}
        />
        <circle cx={42 + 800 * line} cy="48" r="18" fill={palette.green} />
        <text x="42" y="26" fill={palette.dim} fontFamily="Inter, Arial, sans-serif" fontSize="17" fontWeight="900">
          model choice
        </text>
        <text x="666" y="26" fill={palette.dim} fontFamily="Inter, Arial, sans-serif" fontSize="17" fontWeight="900">
          product behavior
        </text>
      </svg>
    </div>
  );
}

function ClosingLine() {
  const frame = useCurrentFrame();
  const show = stageProgress(frame, 1264, 1356);

  return (
    <AbsoluteFill style={{opacity: show, zIndex: 8, pointerEvents: 'none'}}>
      <AbsoluteFill
        style={{
          background: 'linear-gradient(0deg, rgba(10, 13, 14, 0.88) 0%, rgba(10, 13, 14, 0.5) 34%, transparent 64%)'
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
          Know the model behind the product.
        </div>
      </div>
    </AbsoluteFill>
  );
}

export function FourFrontierLabsMotionExample() {
  return (
    <AbsoluteFill style={{background: palette.bg}}>
      <SourceStage />
      <OpeningTitle />
      <LabsCard />
      <IndustryBuildsCard />
      <PoweredByCard />
      <VendorEvaluationCard />
      <ClosingLine />
    </AbsoluteFill>
  );
}
