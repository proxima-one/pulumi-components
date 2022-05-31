import { AppHostHints } from "../components";

export interface AppDefinition {
  executable: {
    image: string;
    app: string;
    version: string;
  };
  version: string;
  input?: string | string[];
  output?: string | Record<string ,string>;
  args?: any;
  hostHints?: AppHostHints;
}

export interface AppHostingOptions {
  dockerRepo: string;
  eventStore?: {
    streamSelector: (
      app: AppDefinition
    ) => (string | { from: string; to: string })[];
    executable: AppDefinition["executable"];
    name: string;
  };
}

export interface AppEnvironment {
  defaultArgs?: any;
  sourceDb: string;
  targetDb: string;
}
