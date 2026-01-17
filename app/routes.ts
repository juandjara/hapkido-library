import { type RouteConfig, index } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  {
    path: "/upload",
    file: "routes/upload.tsx",
  },
] satisfies RouteConfig;
