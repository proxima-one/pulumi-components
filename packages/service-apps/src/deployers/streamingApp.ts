import * as pulumi from "@pulumi/pulumi";
import { AppDeployerBase, DeployParams } from "./base";
import * as k8sServices from "@proxima-one/pulumi-proxima-node";
import {
  mapLookup, StreamingAppHealthcheckOpts,
  StreamingAppService,
} from "@proxima-one/pulumi-proxima-node";
import queryString from "query-string";
import { createHash } from "crypto";
import { strict as assert } from "assert";
import _, { parseInt } from "lodash";
import { ComputeResources } from "@proxima-one/pulumi-k8s-base";

export interface StreamingAppDeployParams extends DeployParams {
  targetDb: { type: "import-kafka"; name: string };
  availableDbs?: pulumi.Input<pulumi.Input<StreamDb>[]>;
  stateManager?: { type: "import"; name: string };
  tuningArgs?: JsonObject;
  maxUndoMs?: pulumi.Input<number>;
}

export interface StreamDb {
  name: string;
  params: any;
  streams: string[];
}

export class StreamingAppDeployer extends AppDeployerBase {
  private streamingApp: k8sServices.StreamingAppDeployer;

  private readonly apps: DeployedApp[] = [];
  private readonly targetDb: pulumi.Output<StreamingAppService>;
  private readonly tuningArgs: JsonObject;
  private readonly stateManager?: pulumi.Output<StreamingAppService>;
  private readonly availableDbs: pulumi.Output<StreamDb[]>;
  private readonly maxUndoMs: pulumi.Output<number | undefined>;

  public constructor(params: StreamingAppDeployParams) {
    super(params);

    this.availableDbs = pulumi
      .output(params.availableDbs)
      .apply((x) => x ?? []);
    this.tuningArgs = params.tuningArgs ?? {};
    this.streamingApp = new k8sServices.StreamingAppDeployer(
      this.getDeployParams("streaming")
    );
    this.targetDb = this.getKafkaStreamDbService(params.targetDb.name);
    this.stateManager = params.stateManager
      ? this.getStateManagerService(params.stateManager.name)
      : undefined;
    this.maxUndoMs = pulumi.output(params.maxUndoMs);
  }

  public getTargetDb(): pulumi.Output<StreamDb> {
    return this.targetDb.apply((x) => ({
      name: x.name,
      params: x.params,
      streams: this.apps.flatMap((x) => x.output),
    }));
  }

  public deployAll(
    apps: StreamingApp<
      string,
      Record<string, string>,
      string,
      Record<string, string>
    >[]
  ): DeployedApp[] {
    return apps.map((x) => this.deploy(x));
  }

  public deploy(
    app: StreamingApp<
      string,
      Record<string, string>,
      string,
      Record<string, string>
    >
  ): DeployedApp {
    const { args, services } = pulumi
      .all([
        this.availableDbs,
        this.targetDb,
        this.stateManager,
        this.resolveServices(app),
      ])
      .apply(([availableDbs, targetDb, stateManager, requiredServices]) => {
        // resolve input using all known streamdbs
        const input = mapLookup(app.input, (stream, key) => {
          const inputStream = InputStream.parse(stream);

          const existInTargetDb = this.apps.find((x) =>
            x.output.includes(inputStream.id)
          );
          const otherDb = existInTargetDb
            ? undefined
            : availableDbs.find((db) => db.streams.includes(inputStream.id))
                ?.name;
          if (!existInTargetDb && !otherDb)
            throw new Error(
              `can't find input stream ${inputStream.id} in any known stream dbs`
            );

          return {
            id: inputStream.id,
            startHeight: inputStream.height,
            db: otherDb,
          };
        });

        const streamProducingArgs = {
          db: this.targetDb.name,
          output: app.output,
        };
        const streamProcessingArgs = {
          stateManager: this.stateManager?.name,
          input: input,
        };

        const args: JsonObject = _.merge(
          {},
          this.tuningArgs,
          streamProducingArgs,
          streamProcessingArgs,
          app.tuningArgs,
          app.args
        );

        const dbsInUse = _.uniq(
          _.values(input)
            .map((x) => x.db)
            .filter((x): x is string => x != undefined)
        );

        const services: StreamingAppService[] = requiredServices;
        services.push(targetDb);

        for (const db of dbsInUse) {
          services.push({
            type: "streamdb",
            name: db,
            params: availableDbs.find((x) => x.name == db)!.params,
          });
        }

        if (stateManager) services.push(stateManager);

        return { args, services };
      });

    const env = pulumi
      .all([app.maxUndoMs, this.maxUndoMs])
      .apply(([appUndo, defaultUndo]) => appUndo ?? defaultUndo)
      .apply((x) => (
        x ? {
          PROXIMA_MAX_UNDO_TIME: x.toString()
        } : {}
      ) as Record<string, string>);

    this.streamingApp.deploy({
      name: app.id,
      args: args,
      dryRun: false,
      healthcheckOptions: app.healthcheckOptions,
      executable: {
        type: "node-runtime-v1",
        imageName: app.executable.image,
        appName: app.executable.app,
      },
      env,
      services: services,
      stackName: this.stack,
      resources: app.resources ?? "50m/1100m,50Mi/2Gi",
    });
    const deployedApp: DeployedApp = {
      name: app.name,
      output: Object.values(app.output),
    };

    this.apps.push(deployedApp);
    return deployedApp;
  }

  private getNetworkService(
    network: Network
  ): pulumi.Output<StreamingAppService> {
    const blockchainGateway = this.requireService<{ endpointTemplate: string }>(
      "main",
      "blockchain-gateway"
    );

    const evmIndexer = this.findAnyService(
      [network, `${network}-indexer`],
      "evm-indexer"
    );

    return pulumi
      .all([blockchainGateway, evmIndexer])
      .apply(([gatewayParams, evmIndexerParams]) => {
        const endpoint = gatewayParams.endpointTemplate.replace(
          "{NETWORK}",
          network
        );
        if (!evmNetworks.includes(network as any))
          throw new Error(`network ${network} is not supported`);

        return {
          type: "eth-network",
          name: network,
          params: {
            network: network,
            type: "eth",
            indexer: evmIndexerParams
              ? {
                  uri: evmIndexerParams.connectionDetails.endpoint,
                  authToken: evmIndexerParams.connectionDetails.authToken,
                }
              : undefined,
            endpoints: {
              http: {
                connectionString: `provider=http;host=${endpoint}`,
                slots: 100,
                dedicated: true,
                fetch: true,
                streaming: false,
              },
              wss: {
                connectionString: `provider=ws;host=${endpoint.replace(
                  "https://",
                  "wss://"
                )}`,
                slots: 10,
                dedicated: true,
                fetch: false,
                streaming: true,
              },
            },
          },
        };
      });
  }

  private getStateManagerService(
    name: string
  ): pulumi.Output<StreamingAppService> {
    return this.requireService(name, "state-manager").apply((params) => ({
      type: "state",
      name: name,
      params: {
        uri: params.connectionDetails.endpoint,
      },
    }));
  }

  private getKafkaStreamDbService(
    name: string
  ): pulumi.Output<StreamingAppService> {
    return this.requireService<any>(name, "kafka").apply((params) => {
      return {
        name: name,
        type: "streamdb",
        params: {
          type: "kafka",
          clientId: this.project,
          brokers: params.connectionDetails.brokers,
          ssl: params.connectionDetails.ssl,
          replicationFactor: params.connectionDetails.replicationFactor ?? 1,
          connectionTimeout: 10000,
          ...(params.credentials
            ? {
                authenticationTimeout: 10000,
                sasl: {
                  mechanism: "plain",
                  username: params.credentials.username,
                  password: params.credentials.password,
                },
              }
            : {}),
        },
      };
    });
  }

  private resolveServices(
    app: StreamingApp<
      string,
      Record<string, string>,
      string,
      Record<string, string>
    >
  ) {
    const services: pulumi.Output<StreamingAppService>[] = [];

    if (app.requirements.network) {
      const networks =
        typeof app.requirements.network == "string"
          ? [app.requirements.network]
          : app.requirements.network;

      services.push(...networks.map((x) => this.getNetworkService(x)));
    }

    return pulumi.all(services);
  }
}

type StreamRecord<T> = T extends null
  ? Record<never, string>
  : T extends string
  ? Record<"default", string>
  : T extends Record<infer TStream, string>
  ? Record<TStream, string>
  : never;

type StreamsDefinition<TKey extends string> =
  | null
  | string
  | Record<TKey, string>;

export interface StreamingAppOptions<
  TInputStreamType extends string,
  TInputStream extends StreamsDefinition<TInputStreamType>,
  TOutputStreamType extends string,
  TOutputStream extends StreamsDefinition<TOutputStreamType>
> {
  executable: AppExecutable;
  version: SemVer;
  input: TInputStream;
  output: TOutputStream;
  name?: string;
  args?: JsonObject;
  tuningArgs?: JsonObject;
  requirements?: AppRequirements;
  resources?: pulumi.Input<ComputeResources>;
  maxUndoMs?: pulumi.Input<number | undefined>;
  healthcheckOptions?: pulumi.Input<StreamingAppHealthcheckOpts>;
}

export interface AppRequirements {
  network?: Network | Network[];
}

export interface AppExecutable {
  image: string;
  app: string;
}

export class InputStream {
  public constructor(
    public readonly id: string,
    public readonly height?: number
  ) {}

  public static parse(val: string): InputStream {
    // proxima.eth-main@1.2?height=1234
    const [id, queryStr] = val.split("?");
    const params = queryStr ? queryString.parse(queryStr) : {};
    return new InputStream(id, tryParseNumber(params["height"]));
  }
}

export class StreamingApp<
  TInputStreamType extends string,
  TInputStream extends StreamsDefinition<TInputStreamType>,
  TOutputStreamType extends string,
  TOutputStream extends StreamsDefinition<TOutputStreamType>
> {
  public readonly executable: Readonly<AppExecutable>;
  public readonly version: SemVer;
  public readonly input: Readonly<StreamRecord<TInputStream>>;
  public readonly output: Readonly<StreamRecord<TOutputStream>>;
  public readonly args: Readonly<JsonObject>;
  public readonly tuningArgs: Readonly<JsonObject>;
  public readonly requirements: Readonly<AppRequirements>;
  public readonly name: string;
  public readonly id: string;
  public readonly resources?: pulumi.Input<ComputeResources>;
  public readonly maxUndoMs?: pulumi.Input<number | undefined>;
  public readonly healthcheckOptions?: pulumi.Input<StreamingAppHealthcheckOpts>;

  public constructor(
    opts: StreamingAppOptions<
      TInputStreamType,
      TInputStream,
      TOutputStreamType,
      TOutputStream
    >
  ) {
    this.name = opts.name ?? opts.executable.app;
    this.executable = opts.executable;
    this.version = opts.version;
    this.resources = opts.resources;
    if (!opts.input) this.input = {} as StreamRecord<TInputStream>;
    else if (typeof opts.input == "string")
      this.input = { default: opts.input } as StreamRecord<TInputStream>;
    else this.input = (opts.input ?? {}) as StreamRecord<TInputStream>;

    if (!opts.output) this.output = {} as StreamRecord<TOutputStream>;
    else if (typeof opts.output == "string")
      this.output = { default: opts.output } as StreamRecord<TOutputStream>;
    else this.output = (opts.output ?? {}) as StreamRecord<TOutputStream>;

    // add versions to output streams
    this.output = mapLookup(
      this.output,
      (item, key) => `${item}.${this.version.major}_${this.version.minor}`
    ) as Readonly<StreamRecord<TOutputStream>>;

    this.args = opts.args ?? {};
    this.tuningArgs = opts.tuningArgs ?? {};
    this.requirements = opts.requirements ?? {};
    this.maxUndoMs = opts.maxUndoMs;
    this.healthcheckOptions = opts.healthcheckOptions;

    const hash = this.buildHash();
    this.id = `${this.name}-${hash.substring(0, 12)}`;
  }

  public buildHash(): string {
    const json = JSON.stringify({
      app: `${this.name}`,
      version: `${this.version.major}.${this.version.minor}`,
      args: this.args,
      input: this.input,
      output: this.output,
      requirements: this.requirements,
    });

    return createHash("sha256").update(json).digest("hex");
  }
}

export class SemVer {
  public constructor(
    public readonly major: number,
    public readonly minor: number,
    public readonly patch: number,
    public readonly suffix: string
  ) {}

  public get isRelease() {
    return !!this.suffix;
  }

  public static parse(val: string): SemVer {
    const suffixIdx = val.indexOf("-");

    const [relaseVersion, suffix] =
      suffixIdx < 0
        ? [val, ""]
        : [val.substring(0, suffixIdx), val.substring(suffixIdx)];

    const parts = relaseVersion.split(".");
    assert(parts.length == 3);

    return new SemVer(
      tryParseNumber(parts[0]) ?? 0,
      tryParseNumber(parts[1]) ?? 0,
      tryParseNumber(parts[2]) ?? 0,
      suffix
    );
  }

  public toString(): string {
    return `${this.major}.${this.minor}.${this.patch}${this.suffix}`;
  }
}

function tryParseNumber(val?: string | number | any): number | undefined {
  if (typeof val == "number") return val;

  if (typeof val == "string") return parseInt(val);

  return undefined;
}

const evmNetworks = [
  "eth-main",
  "eth-goerli",
  "polygon-main",
  "polygon-mumbai",
  "arbitrum-main",
  "bsc-main",
] as const;
const nearNetworks = ["near-main"] as const;

export type Network = typeof evmNetworks[number] | typeof nearNetworks[number];

export interface DeployedApp {
  name: string;
  output: string[];
}

interface ComplexValue extends Readonly<Record<string, Value>> {}

interface ArrayValue extends ReadonlyArray<Value> {}

type Value =
  | ArrayValue
  | ComplexValue
  | string
  | number
  | boolean
  | undefined
  | null;

export type JsonObject = ComplexValue;
