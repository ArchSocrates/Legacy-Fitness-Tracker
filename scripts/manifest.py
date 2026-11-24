import re,sys
p='android/app/src/main/AndroidManifest.xml'
s=open(p).read()
perms=''.join('    <uses-permission android:name="%s" />\n'%x for x in [
 'android.permission.CAMERA','android.permission.POST_NOTIFICATIONS',
 'android.permission.health.READ_STEPS','android.permission.health.READ_HEART_RATE',
 'android.permission.health.READ_SLEEP','android.permission.health.READ_ACTIVE_CALORIES_BURNED'])
perms+='    <uses-feature android:name="android.hardware.camera" android:required="false" />\n'
perms+='    <queries>\n        <package android:name="com.google.android.apps.healthdata" />\n    </queries>\n'
assert '<application' in s
s=s.replace('<application',perms+'    <application',1)
# receiver
s=s.replace('</application>','        <receiver android:name=".RestActionReceiver" android:exported="false" />\n'
 '        <activity-alias android:name="ViewPermissionUsageActivity" android:exported="true" android:targetActivity=".MainActivity" android:permission="android.permission.START_VIEW_PERMISSION_USAGE">\n'
 '            <intent-filter>\n                <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />\n                <category android:name="android.intent.category.HEALTH_PERMISSIONS" />\n            </intent-filter>\n        </activity-alias>\n    </application>',1)
extra=('            <intent-filter>\n                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />\n            </intent-filter>\n'
 '            <intent-filter>\n                <action android:name="android.intent.action.VIEW" />\n                <category android:name="android.intent.category.DEFAULT" />\n                <category android:name="android.intent.category.BROWSABLE" />\n                <data android:scheme="legacy" />\n            </intent-filter>\n'
 '            <meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts" />\n')
m=re.search(r'(<activity\b[^>]*MainActivity[^>]*>)',s)
assert m,'no MainActivity'
s=s[:m.end()]+'\n'+extra+s[m.end():]
s=s.replace('android:allowBackup="true"','android:allowBackup="false"')
open(p,'w').write(s)
print('manifest patched')
