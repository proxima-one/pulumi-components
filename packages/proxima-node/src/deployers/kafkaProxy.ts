import { strict as assert } from "assert";
import * as pulumi from "@pulumi/pulumi";
import {
  WebServiceDeployer,
  DeployedServiceApp,
} from "@proxima-one/pulumi-proxima-node";
import {
  ComputeResources,
  KubernetesServiceDeployer,
  ServiceDeployParameters,
} from "@proxima-one/pulumi-k8s-base";

export class KafkaProxyDeployer extends KubernetesServiceDeployer {
  private readonly webServiceDeployer: WebServiceDeployer;

  constructor(params: ServiceDeployParameters) {
    super(params);
    this.webServiceDeployer = new WebServiceDeployer(params);
  }

  private static generateConfig(connection: KafkaEnvConnectionDetails): string {
    const timeout = connection.timeout ?? 10000;
    const config = {
      clientId: connection.clientId,
      brokers: connection.brokers,
      connectionTimeout: timeout,
      authenticationTimeout: timeout,
      replicationFactor: connection.replicationFactor ?? 1,
      ssl: true,
      sasl: {
        mechanism: "plain",
        username: connection.username,
        password: connection.password,
      },
    };
    return JSON.stringify(config, undefined, 4);
  }

  public deploy(app: KafkaProxy): DeployedKafkaProxy {
    const name = app.name ?? this.name;

    const configPath = "/app/config.json";
    const webService = this.webServiceDeployer.deploy({
      name,
      configFiles: [
        {
          path: configPath,
          content: pulumi
            .output(app.connection)
            .apply(KafkaProxyDeployer.generateConfig),
        },
      ],
      imageName: app.imageName,
      parts: {
        service: {
          resources: app.resources,
          env: {
            CONFIG_PATH: configPath,
          },
          ports: [
            {
              name: "grpc",
              containerPort: 50051,
              servicePort: 443,
              ingress: {
                protocol: "grpc",
              },
            },
          ],
        },
      },
      publicHost: app.publicHost,
    });
    const servicePart = webService.parts["service"];

    let publicConnectionDetails;
    if (app.publicHost !== undefined) {
      publicConnectionDetails = servicePart.ingressRules.apply(
        (rules): KafkaProxyConnectionDetails => {
          assert(rules);
          assert(rules.length == 1);
          assert(rules[0].hosts.length == 1);
          const host = rules[0].hosts[0];
          return {
            endpoint: `${host}:443`,
          };
        }
      );
    }

    const connectionDetails = servicePart.internalHost.apply(
      (host): KafkaProxyConnectionDetails => ({ endpoint: `${host}:50051` })
    );

    return {
      ...webService,
      connectionDetails,
      publicConnectionDetails,
    };
  }
}

export interface KafkaEnvConnectionDetails {
  brokers: string[];
  timeout?: number;
  replicationFactor?: number;

  clientId: string;
  username: string;
  password: string;
}

export interface KafkaProxy {
  name?: string;
  imageName: pulumi.Input<string>;
  publicHost?: pulumi.Input<string>;
  resources?: pulumi.Input<ComputeResources>;
  connection: pulumi.Input<KafkaEnvConnectionDetails>;
}

export interface KafkaProxyConnectionDetails {
  endpoint: string;
}

export interface DeployedKafkaProxy extends DeployedServiceApp {
  connectionDetails: pulumi.Output<KafkaProxyConnectionDetails>;
  publicConnectionDetails?: pulumi.Output<KafkaProxyConnectionDetails>;
}
