import { type RouteConfig, index } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  {
    path: "/upload",
    file: "routes/upload.tsx",
  },
  {
    path: "/access",
    file: "routes/access.tsx",
  },
] satisfies RouteConfig;
