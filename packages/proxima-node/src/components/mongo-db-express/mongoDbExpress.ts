import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import {MongoDB, MongoDBArgs, MongoExpress} from "@proxima-one/pulumi-proxima-node";

interface MongoDbExpressArgs extends MongoDBArgs {
  mongoExpressPublicHost: string
}

export class MongoDbExpress extends pulumi.ComponentResource {

  public readonly mongoDb: MongoDB;
  public readonly mongoExpress: MongoExpress;

  public constructor(
    name: string,
    args: MongoDbExpressArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super("proxima-k8s:MongoExpress", name, args, opts);

    this.mongoDb = new MongoDB(name + "-mongo", args, opts)
    this.mongoExpress = new MongoExpress(name + "-mongo-express", {
      namespace: args.namespace,
      mongodbServer: this.mongoDb.dbAddress,
      mongoAdminAuth: {
        username: "root",
        password: this.mongoDb.adminPassword
      },
      auth: {
        username: "mongo-express",
        password: {type: "random", name: name + "-mongo-express"}
      },
      publicHost: name + `-mongo-express.${args.mongoExpressPublicHost}`
    }, opts)

    this.registerOutputs({
      mongoDb: this.mongoDb,
      mongoExpress: this.mongoExpress
    });

  }
}
