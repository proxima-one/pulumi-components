import * as _ from "lodash";
import {
  AppDefinition,
  AppEnvironment,
  AppHostingOptions,
  HostingOptions,
} from "./interfaces";
import {
  AppExecutable,
  ProximaAppEnvironment,
  ProximaAppMetadata,
} from "../components";

export class ProximaAppFactory {
  public constructor(private readonly options: AppHostingOptions) {}

  public create(
    env: AppEnvironment,
    namespace: string,
    appDefs: Record<string, AppDefinition>
  ): (ProximaAppMetadata & HostingOptions)[] {
    const apps: (ProximaAppMetadata & HostingOptions)[] = [];

    for (const [appKey, appDef] of _.entries(appDefs)) {
      const id = `${namespace}.${appKey}${appDef.version}`;

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
        hints: appDef.hostHints,
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
  sourceDb: string,
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