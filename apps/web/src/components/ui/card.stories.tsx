import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "./button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";

const meta = {
  title: "UI/Card",
  component: Card,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Agent session</CardTitle>
        <CardDescription>
          Short-lived scoped access for local broker delivery modes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Delivery mode: env inject</p>
        <p>Expires in: 55 minutes</p>
      </CardContent>
      <CardFooter className="justify-end gap-2">
        <Button variant="ghost">Revoke</Button>
        <Button>Rotate</Button>
      </CardFooter>
    </Card>
  ),
};
