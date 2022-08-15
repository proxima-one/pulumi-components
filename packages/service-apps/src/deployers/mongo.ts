import * as pulumi from "@pulumi/pulumi";
import {
  AppDeployerBase,
  ComputeResources,
  DeploymentParameters,
} from "./base";
import {
  MongoDB,
  MongoDBAuth,
  MongoDbConnectionDetails,
  MongoDbStorage,
} from "@proxima-one/pulumi-proxima-node";

export class MongoDeployer extends AppDeployerBase {
  public constructor(params: DeploymentParameters) {
    super(params);
  }

  protected get namespace() {
    return this.deployOptions.storage.namespace;
  }

  protected get nodeSelector() {
    return this.deployOptions.nodeSelectors.storage;
  }

  public deploy(app: MongoApp): DeployedMongoApp {
    const name = app.name ?? this.project;
    const mongodb = new MongoDB(
      name,
      {
        nodeSelector: this.nodeSelector,
        resources: pulumi
          .output(app.resources)
          .apply((x) => this.parseResourceRequirements(x ?? defaultResources)),
        namespace: this.namespace,
        auth: app.auth,
        storage: app.storage,
        mongoExpress: app.webUI
          ? {
              endpoint: this.publicHost.apply(
                (host) => `${name}-mongo-express.${host}`
              ),
            }
          : undefined,
      },
      { provider: this.k8s }
    );

    return {
      connectionDetails: mongodb.connectionDetails,
    };
  }
}

const defaultResources = {
  cpu: "50m/100m",
  memory: "100Mi/500Mi",
};

export interface MongoApp {
  name?: string;
  storage: pulumi.Input<MongoDbStorage>;
  version: "4.4";
  auth: MongoDBAuth;
  resources?: pulumi.Input<ComputeResources>;
  replicaSet?: pulumi.Input<number>;
  webUI?: boolean;
}

export interface DeployedMongoApp {
  connectionDetails: pulumi.Output<MongoDbConnectionDetails>;
}
