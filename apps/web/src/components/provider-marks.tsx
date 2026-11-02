import { useId } from "react";

// Transcribed from Google's signin-assets.zip (developers.google.com/identity/branding-guidelines,
// updated 2026-07-07) and GitHub_Logos.zip (brand.github.com/foundations/logo), unchanged in shape
// and color. React's style prop goes through the CSSOM, which the style-src 'self' CSP allows.

const GRADIENT =
  "conic-gradient(from 90deg, rgb(255, 70, 65) 0deg, rgb(255, 70, 65) 4.14555deg, rgb(49, 134, 255) 39.154deg, rgb(49, 134, 255) 72.0044deg, rgb(0, 165, 183) 96.7463deg, rgb(14, 188, 95) 120.897deg, rgb(14, 188, 95) 154.722deg, rgb(108, 196, 0) 179.136deg, rgb(255, 204, 0) 203.588deg, rgb(255, 211, 20) 226.915deg, rgb(255, 204, 0) 251.688deg, rgb(255, 106, 43) 273.129deg, rgb(253, 70, 65) 289.305deg, rgb(255, 70, 65) 359.593deg, rgb(255, 70, 65) 360deg)";

const G_PATH =
  "M29.3987 18.1814H19.9849V22.0445H25.3598C25.1286 23.294 24.4294 24.3596 23.3676 25.0712C22.4746 25.6716 21.3266 26.0211 19.9849 26.0211C17.3864 26.0211 15.1823 24.2666 14.3947 21.9004C14.1952 21.2989 14.0853 20.6599 14.0853 19.9983C14.0853 19.3367 14.1952 18.6966 14.3947 18.0962C15.1823 15.7311 17.3864 13.9755 19.9849 13.9755C21.4524 13.9755 22.767 14.4816 23.8039 15.4713L26.6653 12.6057C24.936 10.9908 22.6786 10 19.9849 10C16.0832 10 12.705 12.2414 11.0618 15.5076C10.383 16.8592 10 18.3834 10 19.9994C10 21.6155 10.383 23.1396 11.0618 24.4913C12.705 27.7597 16.0832 30 19.9849 30C22.6797 30 24.9485 29.1137 26.6018 27.5861C28.4887 25.8452 29.5732 23.2702 29.5732 20.2275C29.5732 19.5182 29.5131 18.835 29.3987 18.1825V18.1814Z";

const RING =
  "M7.25922 19.7927C7.25922 12.6759 13.0209 6.90668 20.1283 6.90668C27.2357 6.90668 32.9973 12.6759 32.9973 19.7927C32.9973 26.9094 27.2357 32.6786 20.1283 32.6786C13.0209 32.6786 7.25921 26.9094 7.25922 19.7927Z";

const BLURS = [
  { cx: 20.0496, cy: 20.2413, rx: 5.39634, ry: 2.83537, fill: "#3186FF", rotate: 24.4473 },
  { cx: 33.3538, cy: 18.2155, rx: 7.43918, ry: 3.09357, fill: "#3186FF", rotate: 0 },
  { cx: 25.2744, cy: 16.2195, rx: 7.40854, ry: 2.37805, fill: "#FF4641", rotate: 0 },
  { cx: 29.5427, cy: 12.9268, rx: 7.40854, ry: 2.37805, fill: "#FF5B8B", rotate: 0 },
  { cx: 24.4817, cy: 19.878, rx: 8.5061, ry: 3.10976, fill: "#3186FF", rotate: 0 },
  { cx: 25.1842, cy: 14.0197, rx: 4.53882, ry: 2.37805, fill: "#FF4641", rotate: -28.6599 },
] as const;

const useSvgId = () => useId().replace(/[^a-zA-Z0-9-]/gu, "");

/** The standard color « super G », alone (the button draws its own background). */
export const GoogleMark = ({ className }: { readonly className: string }) => {
  const id = useSvgId();
  return (
    <svg
      viewBox="10 10 20 20"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <mask
        id={`${id}-mask`}
        maskUnits="userSpaceOnUse"
        x="10"
        y="10"
        width="20"
        height="20"
        style={{ maskType: "alpha" }}
      >
        <path d={G_PATH} fill="#E94FFF" />
      </mask>
      <defs>
        <filter
          id={`${id}-blur`}
          x="0"
          y="0"
          width="45"
          height="40"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur stdDeviation="1" />
        </filter>
        <clipPath id={`${id}-ring`}>
          <path d={RING} />
        </clipPath>
      </defs>
      <g mask={`url(#${id}-mask)`}>
        <g filter={`url(#${id}-blur)`}>
          <g clipPath={`url(#${id}-ring)`}>
            <g transform="matrix(0.00804129 -0.00805186 0.00804128 0.00805186 19.6819 19.7927)">
              <foreignObject x="-2105.64" y="-2105.64" width="4211.29" height="4211.29">
                <div style={{ background: GRADIENT, height: "100%", width: "100%" }} />
              </foreignObject>
            </g>
          </g>
        </g>
        {BLURS.map(({ cx, cy, rx, ry, fill, rotate }) => (
          <g key={`${String(cx)}-${String(cy)}`} filter={`url(#${id}-blur)`}>
            <ellipse
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              fill={fill}
              {...(rotate === 0
                ? {}
                : { transform: `rotate(${String(rotate)} ${String(cx)} ${String(cy)})` })}
            />
          </g>
        ))}
      </g>
    </svg>
  );
};

const INVERTOCAT =
  "M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z";

/** GitHub's Invertocat, black in the light theme and white in the dark one. */
export const GitHubMark = ({ className }: { readonly className: string }) => (
  <svg viewBox="0 0 98 96" aria-hidden="true" focusable="false" className={className}>
    <path d={INVERTOCAT} className="fill-github-mark" />
  </svg>
);
