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

  public deploy(app: KafkaProxy): DeployedKafkaProxy {
    const name = app.name ?? this.name;

    const webService = this.webServiceDeployer.deploy({
      name,
      imageName: app.imageName,
      parts: {
        service: {
          resources: app.resources,
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

    const publicConnectionDetails = servicePart.ingressRules.apply(
      (rules): KafkaProxyConnectionDetails => {
        assert(rules);
        assert(rules.length == 1);
        assert(rules[0].hosts.length == 1);
        const host = rules[0].hosts[0];
        return {
          endpoint: `${host}:443`,
        };
      });

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

export interface KafkaProxyConnectionDetails {
  endpoint: string;
}

export interface KafkaProxy {
  name?: string;
  imageName: pulumi.Input<string>;
  publicHost: pulumi.Input<string>;
  resources?: pulumi.Input<ComputeResources>;
}

export interface DeployedKafkaProxy extends DeployedServiceApp {
  connectionDetails: pulumi.Output<KafkaProxyConnectionDetails>;
  publicConnectionDetails: pulumi.Output<KafkaProxyConnectionDetails>;
}
