import React from 'react';
import {interpolate, spring, useCurrentFrame, useVideoConfig} from 'remotion';

function placementStyle(position, width) {
  const maxWidth = Math.round(width * 0.58);

  if (position === 'bottom') {
    return {
      left: Math.round(width * 0.18),
      right: Math.round(width * 0.18),
      bottom: 108,
      textAlign: 'center',
      maxWidth: 'none'
    };
  }

  if (position === 'bottom-right') {
    return {
      right: 72,
      bottom: 92,
      textAlign: 'right',
      maxWidth
    };
  }

  return {
    left: 72,
    bottom: 92,
    textAlign: 'left',
    maxWidth
  };
}

function cinematicPlacement(position, width, height) {
  const lowerSafeArea = height > width ? 276 : 92;
  const panelWidth = Math.min(548, Math.round(width * 0.51));

  if (position === 'bottom-right') {
    return {
      right: Math.round(width * 0.06),
      bottom: lowerSafeArea,
      width: panelWidth
    };
  }

  if (position === 'bottom') {
    return {
      left: Math.round((width - panelWidth) / 2),
      bottom: lowerSafeArea,
      width: panelWidth
    };
  }

  return {
    left: Math.round(width * 0.055),
    bottom: lowerSafeArea,
    width: panelWidth
  };
}

function placementOffsetY(item) {
  const rawValue = item.offsetY ?? item.offsetYPx ?? 0;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : 0;
}

function withVerticalOffset(style, item) {
  return {
    ...style,
    bottom: Math.max(0, Number(style.bottom || 0) + placementOffsetY(item))
  };
}

function palette(style) {
  if (style === 'cinematic') {
    return {
      accent: '#1388ff',
      accentSoft: '#4fc3ff',
      panel: 'rgba(8, 14, 23, 0.78)',
      title: '#ffffff',
      subtitle: '#dcecff'
    };
  }

  if (style === 'classic') {
    return {
      accent: '#0c78d6',
      panel: 'rgba(8, 12, 18, 0.86)',
      title: '#ffffff',
      subtitle: '#d6e9ff'
    };
  }

  if (style === 'minimal') {
    return {
      accent: '#f0b429',
      panel: 'rgba(8, 10, 12, 0.0)',
      title: '#ffffff',
      subtitle: '#d7d7d2'
    };
  }

  return {
    accent: '#41d6b6',
    panel: 'rgba(7, 9, 12, 0.74)',
    title: '#ffffff',
    subtitle: '#d7fff6'
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function frameWindow(item, fps) {
  const start = Math.round((item.at || 0) * fps);
  const duration = Math.max(1, Math.round((item.duration || 5) * fps));
  return {
    start,
    end: start + duration,
    duration
  };
}

const KineticLowerThird = ({item, fps, frame, window, width, height}) => {
  const localFrame = frame - window.start;
  const exitStart = window.end - Math.min(18, Math.floor(window.duration / 3));
  const exitFrame = Math.max(0, frame - exitStart);
  const intro = clamp01(spring({
    frame: localFrame,
    fps,
    config: {
      damping: 18,
      stiffness: 132,
      mass: 0.72
    }
  }));
  const exit = frame >= exitStart ? clamp01(spring({
    frame: exitFrame,
    fps,
    config: {
      damping: 18,
      stiffness: 118,
      mass: 0.76
    }
  })) : 0;
  const titleReveal = interpolate(
    localFrame,
    [8, 22],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );
  const subtitleReveal = interpolate(
    localFrame,
    [17, 32],
    [0, 1],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );
  const sweep = interpolate(
    localFrame,
    [10, 39],
    [-0.18, 1.12],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );
  const sweepOpacity = interpolate(
    localFrame,
    [8, 15, 38, 46],
    [0, 0.8, 0.8, 0],
    {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
  );
  const colors = palette('cinematic');
  const placement = withVerticalOffset(
    cinematicPlacement(item.position || 'bottom-left', width, height),
    item
  );
  const panelHeight = 126;
  const textAlign = item.position === 'bottom-right' ? 'right' : 'left';
  const groupX = -150 * (1 - intro) - 96 * exit;
  const opacity = intro * (1 - exit);

  return (
    <div
      style={{
        position: 'absolute',
        ...placement,
        height: 158,
        opacity,
        transform: `translateX(${groupX}px) skewX(${-3 * (1 - intro) + 2 * exit}deg) scale(${0.985 + intro * 0.015 - exit * 0.02})`,
        transformOrigin: item.position === 'bottom-right' ? 'right center' : 'left center',
        fontFamily: 'Arial, Helvetica, sans-serif'
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 16,
          width: placement.width,
          height: panelHeight,
          borderRadius: 8,
          background: `linear-gradient(105deg, ${colors.panel} 0%, rgba(17, 27, 39, 0.7) 58%, rgba(8, 12, 19, 0.28) 100%)`,
          border: '1px solid rgba(215, 232, 255, 0.33)',
          boxShadow: '0 22px 48px rgba(0, 0, 0, 0.36), 0 0 28px rgba(19, 136, 255, 0.22), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0%, rgba(255, 255, 255, 0.035) 35%, rgba(0, 0, 0, 0) 100%)'
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: `${sweep * 100}%`,
            top: -22,
            width: 72,
            height: panelHeight + 48,
            opacity: sweepOpacity,
            transform: 'skewX(-18deg)',
            background: 'linear-gradient(90deg, rgba(255, 255, 255, 0), rgba(111, 196, 255, 0.42), rgba(255, 255, 255, 0))'
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: -22,
            top: 0,
            width: 84,
            height: panelHeight,
            transform: 'skewX(-22deg)',
            borderLeft: '1px solid rgba(185, 216, 255, 0.28)',
            background: 'linear-gradient(90deg, rgba(19, 136, 255, 0.16), rgba(19, 136, 255, 0))'
          }}
        />
      </div>

      <div
        style={{
          position: 'absolute',
          left: 16,
          top: 38,
          width: 6,
          height: 82,
          borderRadius: 6,
          transform: `scaleY(${interpolate(localFrame, [2, 16], [0.08, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})})`,
          transformOrigin: 'center',
          background: `linear-gradient(180deg, ${colors.accentSoft}, ${colors.accent})`,
          boxShadow: `0 0 18px ${colors.accent}`
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 38,
          top: 31,
          width: placement.width - 74,
          height: 1,
          transform: `scaleX(${interpolate(localFrame, [5, 26], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})})`,
          transformOrigin: 'left center',
          background: 'linear-gradient(90deg, rgba(93, 181, 255, 0.86), rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0))'
        }}
      />

      <div
        style={{
          position: 'absolute',
          left: 46,
          right: 24,
          top: 43,
          overflow: 'hidden',
          textAlign
        }}
      >
        <div
          style={{
            color: colors.title,
            fontSize: 42,
            fontWeight: 780,
            lineHeight: 1.02,
            letterSpacing: 0,
            opacity: titleReveal,
            transform: `translateX(${-26 + titleReveal * 26}px)`,
            textShadow: '0 3px 18px rgba(0, 0, 0, 0.72)',
            whiteSpace: 'nowrap'
          }}
        >
          {item.title}
        </div>
      </div>

      {item.subtitle ? (
        <div
          style={{
            position: 'absolute',
            left: 48,
            right: 24,
            top: 92,
            overflow: 'hidden',
            textAlign
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 11,
              color: colors.subtitle,
              fontSize: 22,
              fontWeight: 540,
              lineHeight: 1.14,
              letterSpacing: 3,
              opacity: subtitleReveal,
              transform: `translateX(${-18 + subtitleReveal * 18}px)`,
              textShadow: '0 2px 14px rgba(0, 0, 0, 0.7)',
              whiteSpace: 'nowrap'
            }}
          >
            <span
              style={{
                display: 'inline-block',
                width: 7,
                height: 7,
                borderRadius: 2,
                background: colors.accent,
                boxShadow: `0 0 14px ${colors.accent}`
              }}
            />
            {item.subtitle}
          </div>
        </div>
      ) : null}

      <div
        style={{
          position: 'absolute',
          left: 4,
          top: 148,
          display: 'flex',
          gap: 8,
          opacity: interpolate(localFrame, [20, 35], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'})
        }}
      >
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            style={{
              width: 7,
              height: 7,
              borderRadius: 999,
              background: dot === 0 ? colors.accentSoft : colors.accent,
              boxShadow: `0 0 10px ${colors.accent}`
            }}
          />
        ))}
      </div>
    </div>
  );
};

export const LowerThirdLayer = ({items = [], fps}) => {
  const frame = useCurrentFrame();
  const {width, height} = useVideoConfig();

  return (
    <>
      {items.map((item, index) => {
        const window = frameWindow(item, fps);
        if (frame < window.start || frame >= window.end) {
          return null;
        }

        if (item.style === 'cinematic') {
          return (
            <KineticLowerThird
              key={`${item.title}-${index}`}
              item={item}
              fps={fps}
              frame={frame}
              window={window}
              width={width}
              height={height}
            />
          );
        }

        const introFrames = Math.min(12, Math.floor(window.duration / 3));
        const exitFrames = Math.min(10, Math.floor(window.duration / 3));
        const opacity = interpolate(
          frame,
          [window.start, window.start + introFrames, window.end - exitFrames, window.end],
          [0, 1, 1, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        );
        const translateY = interpolate(
          frame,
          [window.start, window.start + introFrames],
          [18, 0],
          {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}
        );
        const colors = palette(item.style || 'modern');
        const isMinimal = item.style === 'minimal';

        return (
          <div
            key={`${item.title}-${index}`}
            style={{
              position: 'absolute',
              ...withVerticalOffset(placementStyle(item.position || 'bottom-left', width), item),
              opacity,
              transform: `translateY(${translateY}px)`,
              fontFamily: 'Inter, Arial, sans-serif'
            }}
          >
            <div
              style={{
                display: 'inline-grid',
                gridTemplateColumns: item.position === 'bottom-right' ? '1fr 6px' : '6px 1fr',
                gap: 14,
                alignItems: 'stretch',
                padding: isMinimal ? 0 : '16px 18px',
                borderRadius: isMinimal ? 0 : 6,
                background: colors.panel,
                boxShadow: isMinimal ? 'none' : '0 16px 38px rgba(0, 0, 0, 0.36)'
              }}
            >
              {item.position === 'bottom-right' ? null : (
                <div style={{background: colors.accent, borderRadius: 3}} />
              )}
              <div>
                <div
                  style={{
                    color: colors.title,
                    fontSize: isMinimal ? 38 : 42,
                    fontWeight: 760,
                    lineHeight: 1.02,
                    textShadow: '0 3px 16px rgba(0, 0, 0, 0.62)',
                    overflowWrap: 'break-word'
                  }}
                >
                  {item.title}
                </div>
                {item.subtitle ? (
                  <div
                    style={{
                      marginTop: 7,
                      color: colors.subtitle,
                      fontSize: isMinimal ? 24 : 26,
                      fontWeight: 520,
                      lineHeight: 1.12,
                      textShadow: '0 2px 12px rgba(0, 0, 0, 0.62)',
                      overflowWrap: 'break-word'
                    }}
                  >
                    {item.subtitle}
                  </div>
                ) : null}
              </div>
              {item.position === 'bottom-right' ? (
                <div style={{background: colors.accent, borderRadius: 3}} />
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
};
