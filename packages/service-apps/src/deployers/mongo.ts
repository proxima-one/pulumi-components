import * as k8sServices from "@proxima-one/pulumi-proxima-node";
import { AppDeployerBase } from "./base";

export class MongoDeployer extends AppDeployerBase {
  public deploy(app: MongoApp): DeployedMongoApp {
    return new k8sServices.deployers.MongoDeployer(
      this.getDeployParams("indexing-storage")
    ).deploy(app);
  }
}

export interface MongoApp extends k8sServices.deployers.MongoApp {}

export interface DeployedMongoApp
  extends k8sServices.deployers.DeployedMongoApp {}
