import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Badge } from "./badge";
import { Button } from "./button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";

const meta = {
  title: "UI/Table",
  component: Table,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Table>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AccessLog: Story = {
  render: () => (
    <div className="w-full max-w-5xl">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Agent</TableHead>
            <TableHead>Credential</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Outcome</TableHead>
            <TableHead>Requested</TableHead>
            <TableHead className="w-[120px] text-right">Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell className="font-medium">claude-desktop</TableCell>
            <TableCell>OpenAI prod key</TableCell>
            <TableCell>env inject</TableCell>
            <TableCell>
              <Badge variant="success">Allowed</Badge>
            </TableCell>
            <TableCell>2026-04-05 09:42</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="outline">
                Inspect
              </Button>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">codex-ci</TableCell>
            <TableCell>Stripe staging token</TableCell>
            <TableCell>file mount</TableCell>
            <TableCell>
              <Badge variant="warning">Pending approval</Badge>
            </TableCell>
            <TableCell>2026-04-05 10:06</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="outline">
                Review
              </Button>
            </TableCell>
          </TableRow>
          <TableRow>
            <TableCell className="font-medium">browser-agent</TableCell>
            <TableCell>Payroll export</TableCell>
            <TableCell>reveal</TableCell>
            <TableCell>
              <Badge variant="destructive">Denied</Badge>
            </TableCell>
            <TableCell>2026-04-05 10:19</TableCell>
            <TableCell className="text-right">
              <Button size="sm" variant="ghost">
                Details
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
};
