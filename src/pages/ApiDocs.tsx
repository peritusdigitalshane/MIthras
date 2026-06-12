import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BookOpen, KeyRound, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";

const SPEC_URL = "https://api.mithras.com.au/functions/v1/api-v1/openapi.json";

export default function ApiDocs() {
  return (
    <MainLayout>
      <div className="p-6 space-y-6 max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <BookOpen className="h-6 w-6 text-primary" />
              API documentation
            </h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Mithras Threat Defence REST API reference. Use this surface to onboard customers, deploy agents, read posture, retrieve incidents, and pull monthly reports.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link to="/settings/api-keys"><KeyRound className="h-4 w-4 mr-1" />Manage API keys</Link>
            </Button>
            <Button asChild variant="outline">
              <a href={SPEC_URL} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-1" />OpenAPI spec
              </a>
            </Button>
          </div>
        </div>

        <Alert>
          <KeyRound className="h-4 w-4" />
          <AlertTitle>Authentication</AlertTitle>
          <AlertDescription>
            All endpoints require an <code className="text-xs">Authorization: Bearer mit_live_&lt;token&gt;</code> header. Create a token from{" "}
            <Link to="/settings/api-keys" className="text-primary hover:underline">Settings → API keys</Link>. The raw token is shown once at creation; store it in your secret manager.
          </AlertDescription>
        </Alert>

        <Card>
          <CardContent className="p-0 swagger-host">
            <SwaggerUI
              url={SPEC_URL}
              docExpansion="list"
              defaultModelsExpandDepth={1}
              persistAuthorization
              tryItOutEnabled
            />
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
