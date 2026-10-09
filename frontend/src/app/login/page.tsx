"use client";

import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Header from "@cloudscape-design/components/header";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import "@/lib/theme";

function safeNext(next: string | null): string {
  // Only allow same-site relative paths to avoid open redirects.
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setSubmitted(true);
    if (!username || !password) return;
    setLoading(true);
    setError("");
    try {
      await api.login(username, password);
      router.replace(safeNext(params.get("next")));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Sign in failed.");
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <div className="login-logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/aws-logo.svg" alt="AWS" width={64} height={38} />
      </div>
      <div className="login-card">
        <SpaceBetween size="m">
          {params.get("expired") && (
            <Alert type="info">Your session has expired. Sign in again to continue.</Alert>
          )}
          <Container header={<Header variant="h1">Sign in</Header>}>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submit();
              }}
            >
              <Form
                errorText={error || undefined}
                actions={
                  <Button variant="primary" formAction="submit" loading={loading} fullWidth>
                    Sign in
                  </Button>
                }
              >
                <SpaceBetween size="l">
                  <FormField
                    label="Username"
                    errorText={submitted && !username ? "Enter your username." : undefined}
                  >
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.detail.value)}
                      autoComplete="username"
                      autoFocus
                    />
                  </FormField>
                  <FormField
                    label="Password"
                    errorText={submitted && !password ? "Enter your password." : undefined}
                  >
                    <Input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.detail.value)}
                      autoComplete="current-password"
                    />
                  </FormField>
                </SpaceBetween>
              </Form>
            </form>
          </Container>
          <Alert type="info" header="Demo account">
            This is a mock sign-in for a Route 53 console clone. Use username <b>demo</b> and password{" "}
            <b>demo1234</b>.
          </Alert>
          <Box textAlign="center" color="text-body-secondary" fontSize="body-s">
            Not affiliated with Amazon Web Services. No real AWS resources are used.
          </Box>
        </SpaceBetween>
      </div>
    </main>
  );
}
