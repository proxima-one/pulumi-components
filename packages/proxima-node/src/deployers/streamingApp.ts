import * as yaml from "js-yaml";
import * as pulumi from "@pulumi/pulumi";
import * as _ from "lodash";
import {
  ComputeResources,
  KubernetesServiceDeployer,
  ServiceDeployParameters,
} from "@proxima-one/pulumi-k8s-base";
import { parseMemory } from "../helpers/resources-parser";
import { WebServiceDeployer } from "@proxima-one/pulumi-proxima-node";

export class StreamingAppDeployer extends KubernetesServiceDeployer {
  private readonly webServiceDeployer: WebServiceDeployer;

  public constructor(params: ServiceDeployParameters) {
    super(params);
    this.webServiceDeployer = new WebServiceDeployer(params);
  }

  public deployAll(apps: StreamingApp[]): DeployedStreamingApp[] {
    return apps.map(x => this.deploy(x));
  }

  public deploy(app: StreamingApp): DeployedStreamingApp {
    // deploy as webservice just without publishing ports. does webServiceDeployer still correct name??
    const resolvedArgs = pulumi.output(app);
    const deployed = resolvedArgs.apply((app) => {
      const resources = app.resources ?? "50m/1100m,50Mi/2Gi";
      const memoryLimitMB = _.floor(
        parseMemory(this.getResourceRequirements(resources).limits.memory) /
          1024 ** 2
      );
      this.webServiceDeployer.deploy({
        name: app.name,
        imageName: app.executable.imageName,
        parts: {
          app: {
            args: [
              "app",
              "start",
              app.executable.appName,
              "--id",
              app.name,
              "--app-args",
              JSON.stringify(app.args),
              ...(app.dryRun ? ["--dry-run"] : []),
            ],
            deployStrategy: { type: "Recreate" },
            resources: resources,
            env: {
              PROXIMA_APP_SERVICES_PATH: "/app/services.yml",
              NODE_EXTRA_CA_CERTS:
                "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt",
              NODE_OPTIONS: `--max_old_space_size=${memoryLimitMB}`,
            },
          },
        },
        configFiles: [
          {
            path: "/app/services.yml",
            content: (app.services ?? [])
              .map((s) => yaml.dump(s, { indent: 2 }))
              .join("---\n"),
          },
        ],
      });
      return { name: app.name };
    });

    return {
      name: deployed.name,
    };
  }
}

export interface StreamingApp {
  name: pulumi.Input<string>;
  args: pulumi.Input<any>;
  executable: pulumi.Input<StreamingAppExecutable>;
  dryRun?: pulumi.Input<boolean>;
  services?: pulumi.Input<pulumi.Input<StreamingAppService>[]>;
  resources?: pulumi.Input<ComputeResources>;
}

export interface StreamingAppService {
  type: string;
  name: string;
  params: any;
}

export interface DeployedStreamingApp {
  name: pulumi.Output<string>;
}

export type StreamingAppExecutable = NodeRuntimeV1;

export interface NodeRuntimeV1 {
  type: "node-runtime-v1";

  imageName: string;
  appName: string;
}