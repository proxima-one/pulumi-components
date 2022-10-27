import {
  ComputeResources,
  ServiceDeployParameters,
  Storage,
} from "@proxima-one/pulumi-k8s-base";
import * as pulumi from "@pulumi/pulumi";
import { strict as assert } from "assert";
import { DeployedServiceApp, WebServiceDeployer } from "./webService";
import { MongoDeployer } from "./mongo";

export class StreamRegistryDeployer {
  private readonly webServiceDeployer: WebServiceDeployer;
  private readonly mongoDeployer: MongoDeployer;

  public constructor(params: ServiceDeployParameters) {
    this.webServiceDeployer = new WebServiceDeployer(params);
    this.mongoDeployer = new MongoDeployer(params);
  }

  public deploy(app: StreamRegistry): DeployedStreamRegistry {
    const db: DbSettings = app.db ?? {
      type: "provision",
      params: {
        storage: {
          size: "10Gi",
          class: "",
        },
        webUI: app.publicHost ? {} : undefined,
      },
    };

    let webUiPublicHost;
    if (db.params.webUI) {
      if (db.params.webUI.overridePublicHost) {
        webUiPublicHost = db.params.webUI.overridePublicHost;
      } else {
        if (app.publicHost) {
          webUiPublicHost = `${app.name}-mongo.${app.publicHost}`;
        }
      }
    }

    const mongo = this.mongoDeployer.deploy({
      name: app.name,
      storage: db.params.storage,
      resources: db.params.resource,
      auth: {
        database: "stream-registry",
        user: "proxima",
        password: { type: "random", name: `${app.name}-mongo`, length: 32 },
      },
      webUI: webUiPublicHost !== undefined,
      publicHost: webUiPublicHost,
      version: "4.4",
    });

    const containerPort = 3000;
    const resources = app.resources ?? "50m/100m,100Mi/200Mi";
    const webService = this.webServiceDeployer.deploy({
      name: app.name,
      imageName: app.imageName,
      parts: {
        server: {
          args: ["server"],
          env: {
            MONGO_ADDRESS: mongo.connectionDetails.endpoint,
            MONGO_DB: mongo.connectionDetails.database,
            PORT: containerPort.toString(),
          },
          resources,
          ports: [
            {
              name: "http",
              containerPort: containerPort,
              servicePort: 80,
              ingress: app.publicHost
                ? {
                    host: [`stream-api.${app.publicHost}`],
                  }
                : undefined,
            },
          ],
        },
        "background-worker": {
          args: ["background-worker"],
          env: {
            MONGO_ADDRESS: mongo.connectionDetails.endpoint,
            MONGO_DB: mongo.connectionDetails.database,
            STATS_ENDPOINT: app.streamDbEndpoints.url,
            META_ENDPOINT: app.streamsMetadata.url,
            STATS_INTERVAL: app.streamDbEndpoints.updateInterval ?? "10MIN",
            META_INTERVAL: app.streamsMetadata.updateInterval ?? "1HR",
          },
          resources,
        },
      },
    });

    const serverPart = webService.parts["server"];

    const connectionDetails = serverPart.internalHost.apply((host) => {
      assert(host);
      return {
        endpoint: `${host}:${containerPort}`,
      };
    });

    let publicConnectionDetails;
    if (app.publicHost !== undefined) {
      publicConnectionDetails = serverPart.ingressRules.apply((rules) => {
        assert(rules);
        assert(rules.length == 1);
        assert(rules[0].hosts.length == 1);
        const host = rules[0].hosts[0];
        return {
          endpoint: `${host}:80`,
        };
      });
    }

    return {
      name: app.name,
      type: "stream-registry",
      params: {
        ...webService,
        connectionDetails,
        publicConnectionDetails,
      },
    };
  }
}

export interface StreamRegistry {
  name: string;
  imageName: string;
  resources?: ComputeResources;
  db?: DbSettings;
  publicHost?: string;
  streamDbEndpoints: {
    url: string;
    updateInterval?: string;
  };
  streamsMetadata: {
    url: string;
    updateInterval?: string;
  };
}

type DbSettings = {
  type: "provision";
  params: {
    resource?: ComputeResources;
    storage: Storage;
    webUI?: {
      overridePublicHost?: string;
    };
  };
};

export interface StreamRegistryConnectionDetails {
  endpoint: string;
}

export interface DeployedStreamRegistryParams extends DeployedServiceApp {
  connectionDetails: pulumi.Output<StreamRegistryConnectionDetails>;
  publicConnectionDetails?: pulumi.Output<StreamRegistryConnectionDetails>;
}

export interface DeployedStreamRegistry {
  name: string;
  type: "stream-registry";
  params: DeployedStreamRegistryParams;
}
