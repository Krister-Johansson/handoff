import { NotificationSettingsLoader } from "@/components/settings/notification-settings-loader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Settings for this dashboard. Project settings are on each project&apos;s Settings tab.</p>
      </div>
      <Card id="notifications" className="max-w-2xl scroll-mt-6">
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>How this browser tells you that a run needs you.</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationSettingsLoader />
        </CardContent>
      </Card>
    </main>
  );
}
