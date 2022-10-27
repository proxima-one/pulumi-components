import * as _ from "lodash";
import {
  AppDefinition,
  AppEnvironment,
  AppHostingOptions,
  InputStreamDef,
} from "./interfaces";
import {
  AppExecutable,
  ProximaAppHostingOptions,
  ProximaAppEnvironment,
  ProximaAppMetadata,
} from "../components";

export class ProximaAppFactory {
  public constructor(private readonly options: AppHostingOptions) {}

  public createNewRuntime(
    env: AppEnvironment,
    namespace: string,
    appDefs: Record<string, AppDefinition>
  ): (ProximaAppMetadata & ProximaAppHostingOptions)[] {

    const apps: (ProximaAppMetadata & ProximaAppHostingOptions)[] = [];

    for (const [appKey, appDef] of _.entries(appDefs)) {
      const id = `${namespace}.${appKey}${appDef.version}`;


      let inputStreams: Record<string, InputStreamDef | InputStreamDef[]> = {};


      if (typeof appDef.input == "string")
        inputStreams["default"] = { id: appDef.input };
      else if (Array.isArray(appDef.input))
        inputStreams["default"] = appDef.input.map((x) => ({ id: x }));
      else if (appDef.input) inputStreams = appDef.input;

      let outputStreams: Record<string, string> = {};
      if (typeof appDef.output == "string")
        outputStreams["default"] = appDef.output;
      else if (appDef.output) outputStreams = appDef.output;

      apps.push({
        id: id,
        env: {},
        executable: proximaStreamingApp(
          this.options.dockerRepo,
          appDef.executable
        ),
        args: _.merge(
          {},
          env.defaultArgs ?? {},
          {
            db: env.targetDb,
            output: outputStreams,
            input: inputStreams,
          },
          appDef.args
        ),
        hostHints: appDef.hostHints,
      });
    }

    return apps;
  }

  public create(
    env: AppEnvironment,
    namespace: string,
    appDefs: Record<string, AppDefinition>
  ): (ProximaAppMetadata & ProximaAppHostingOptions)[] {
    const apps: (ProximaAppMetadata & ProximaAppHostingOptions)[] = [];

    for (const [appKey, appDef] of _.entries(appDefs)) {
      const id = `${namespace}.${appKey}${appDef.version}`;

      if (typeof appDef.input == "object")
        throw new Error(
          "Input object is not supported. Try createNewRuntime() instead"
        );

      apps.push({
        id: id,
        env: proximaEnv(env.sourceDb, env.targetDb, appDef.input),
        executable: proximaStreamingApp(
          this.options.dockerRepo,
          appDef.executable
        ),
        args: _.merge(
          {},
          env.defaultArgs ?? {},
          { outputStream: appDef.output },
          appDef.args
        ),
        hostHints: appDef.hostHints,
      });
    }

    const eventStore = this.options.eventStore;
    if (eventStore) {
      const streamsToSink = _.chain(appDefs)
        .values()
        .map((x) => eventStore.streamSelector(x))
        .flatten()
        .value();
      const eventStoreSinkApps: ProximaAppMetadata[] = streamsToSink.map(
        (stream) => {
          const from = typeof stream == "string" ? stream : stream.from;
          const to = typeof stream == "string" ? stream : stream.to;

          return {
            env: proximaEnv(env.sourceDb, env.targetDb, from),
            args: {
              batch: "500",
              readBuffer: "10000",
              eventStoreDb: eventStore.name,
              statesToTrack: 2000,
              eventStoreStream: to,
            },
            id: `eventStore.${from}`,
            executable: proximaStreamingApp(
              this.options.dockerRepo,
              eventStore.executable
            ),
          };
        }
      );

      apps.push(...eventStoreSinkApps);
    }
    return apps;
  }
}

function proximaStreamingApp(
  dockerRepo: string,
  appExecutable: AppDefinition["executable"]
): AppExecutable {
  return {
    type: "docker",
    image: `${dockerRepo}:${appExecutable.image}-${appExecutable.version}`,
    appName: appExecutable.app,
  };
}

function proximaEnv(
  sourceDb: string | undefined,
  targetDb: string,
  sourceStream: string | string[] | undefined
): ProximaAppEnvironment {
  return {
    sourceDb:
      sourceStream === undefined
        ? undefined
        : sourceDb == targetDb
        ? undefined
        : sourceDb,
    db: targetDb,
    sourceStream: typeof sourceStream == "string" ? sourceStream : undefined,
    sourceStreams: Array.isArray(sourceStream) ? sourceStream : undefined,
  };
}
